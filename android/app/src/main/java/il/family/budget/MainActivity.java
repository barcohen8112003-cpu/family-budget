package il.family.budget;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.provider.Settings;

import org.json.JSONObject;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/** מעטפת WebView: טוענת את האפליקציה מתוך ה-APK, בלי גישה לרשת. */
public class MainActivity extends Activity {
    private static final String HOST = "app.local";
    private static final String API_HOST = "family-budget.naorkurtz1.workers.dev";
    private static final int PICK_FILES = 1;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingLink;

    /** קישור שיתוף שנפתח באפליקציה (https://.../join#... או familybudget://join/...). */
    private static String linkFrom(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return null;
        return intent.getData().toString();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String link = linkFrom(intent);
        if (link != null && web != null) {
            pendingLink = link;
            web.evaluateJavascript("window.Share && Share.incoming()", null);
        }
    }

    /** מעביר למסכים את מצב עדכון האפליקציה (הורדה, אישור, שגיאה). */
    void updateStatus(String state, String message) {
        runOnUiThread(() -> {
            if (web != null) web.evaluateJavascript("window.AppUpd && AppUpd.status(" + JSONObject.quote(state) + "," + JSONObject.quote(message == null ? "" : message) + ")", null);
        });
    }

    // תשובת מתקין אנדרואיד: לפתוח את חלון האישור, או לדווח על שגיאה/ביטול
    private final BroadcastReceiver installResult = new BroadcastReceiver() {
        @Override
        @SuppressWarnings("deprecation")
        public void onReceive(Context ctx, Intent intent) {
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm != null) {
                    confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(confirm);
                }
            } else if (status == PackageInstaller.STATUS_FAILURE_ABORTED) {
                updateStatus("cancelled", "");
            } else if (status != PackageInstaller.STATUS_SUCCESS) {
                updateStatus("error", intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
            }
        }
    };

    @Override
    protected void onDestroy() {
        try {
            unregisterReceiver(installResult);
        } catch (Exception ignored) {
        }
        super.onDestroy();
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        pendingLink = linkFrom(getIntent());
        IntentFilter filter = new IntentFilter(AppUpdater.ACTION);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(installResult, filter, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(installResult, filter);
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        Updater.resetIfApkChanged(this);
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                // הכתובת החיצונית היחידה שמותרת: שרת השיתוף והשערים של האפליקציה (/api/)
                if (API_HOST.equals(uri.getHost()) && "https".equals(uri.getScheme()) && uri.getPath() != null && uri.getPath().startsWith("/api/")) return null;
                if (!HOST.equals(uri.getHost())) return blocked();
                String path = uri.getPath() == null || uri.getPath().equals("/") ? "index.html" : uri.getPath().substring(1);
                try {
                    // קובץ שעודכן מהאתר גובר על הקובץ הארוז ב-APK
                    File live = Updater.liveFile(MainActivity.this, path);
                    InputStream in = live.isFile() ? new FileInputStream(live) : getAssets().open(path);
                    return new WebResourceResponse(mime(path), isText(path) ? "utf-8" : null, in);
                } catch (Exception e) {
                    return blocked();
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !HOST.equals(request.getUrl().getHost());
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(intent, PICK_FILES);
                } catch (Exception e) {
                    fileCallback = null;
                    callback.onReceiveValue(null);
                    toast("לא נמצאה אפליקציה לבחירת קבצים");
                }
                return true;
            }
        });

        if (state != null) web.restoreState(state);
        else web.loadUrl("https://" + HOST + "/index.html");

        // בדיקת עדכון ברקע. גרסה חדשה נטענת בפתיחה הבאה של האפליקציה
        Updater.checkInBackground(this, version -> toast("האפליקציה עודכנה. הגרסה החדשה תופעל בפתיחה הבאה."));
    }

    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, new ByteArrayInputStream(new byte[0]));
    }

    private static boolean isText(String path) {
        return path.endsWith(".html") || path.endsWith(".js") || path.endsWith(".css") || path.endsWith(".json") || path.endsWith(".svg");
    }

    private static String mime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        String ext = MimeTypeMap.getFileExtensionFromUrl(path);
        String m = ext == null ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        return m == null ? "application/octet-stream" : m;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != PICK_FILES || fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                result = new Uri[n];
                for (int i = 0; i < n; i++) result[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) {
                result = new Uri[]{data.getData()};
            }
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    @Override
    public void onBackPressed() {
        // האפליקציה מחליטה: סגירת חלון קופץ, חזרה ללוח הבקרה, או יציאה
        web.evaluateJavascript("(window.App && App.onBack) ? App.onBack() : false", value -> {
            if (!"true".equals(value)) finish();
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    private void toast(String text) {
        runOnUiThread(() -> Toast.makeText(this, text, Toast.LENGTH_LONG).show());
    }

    /** גשר ל-JavaScript: שמירת קבצים, הדפסה, שליחת קישור וקבלת קישור שיתוף. */
    private class Bridge {
        /** גרסת הגשר. 2 = שיתוף, שערים וקישורים. 3 = עדכון האפליקציה מתוכה. */
        @JavascriptInterface
        public int apiVersion() {
            return 3;
        }

        @JavascriptInterface
        @SuppressWarnings("deprecation")
        public int appVersionCode() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
            } catch (Exception e) {
                return 0;
            }
        }

        @JavascriptInterface
        public String appVersionName() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }

        /** האם המשתמש כבר אישר לאפליקציה להתקין עדכונים. */
        @JavascriptInterface
        public boolean canInstall() {
            return Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls();
        }

        @JavascriptInterface
        public void openInstallPermission() {
            runOnUiThread(() -> startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()))));
        }

        @JavascriptInterface
        public void installUpdate(String sha256) {
            AppUpdater.install(MainActivity.this, sha256, MainActivity.this::updateStatus);
        }

        @JavascriptInterface
        public String takeLink() {
            String link = pendingLink;
            pendingLink = null;
            return link;
        }

        @JavascriptInterface
        public void shareText(String text) {
            runOnUiThread(() -> {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(send, "שליחת קישור לתקציב"));
            });
        }

        @JavascriptInterface
        public void saveFile(String name, String mimeType, String base64) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    v.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                    v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new IllegalStateException("insert failed");
                    try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                        out.write(bytes);
                    }
                    toast("הקובץ נשמר בתיקיית ההורדות: " + name);
                } else {
                    File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    File f = new File(dir, name);
                    try (FileOutputStream out = new FileOutputStream(f)) {
                        out.write(bytes);
                    }
                    toast("הקובץ נשמר: " + f.getAbsolutePath());
                }
            } catch (Exception e) {
                toast("שמירת הקובץ נכשלה: " + e.getMessage());
            }
        }

        @JavascriptInterface
        public void print(String title) {
            runOnUiThread(() -> {
                PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                pm.print(title, web.createPrintDocumentAdapter(title), new PrintAttributes.Builder().build());
            });
        }
    }
}
