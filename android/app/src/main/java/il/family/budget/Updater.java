package il.family.budget;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

/**
 * עדכון קובצי האפליקציה (HTML/JS/CSS) מהאתר, בלי להתקין APK מחדש.
 * מוריד רק קבצים שהשתנו, מאמת גיבוב, ושומר אותם בתיקייה מקומית שגוברת על הקבצים הארוזים ב-APK.
 * זו התקשורת היחידה של האפליקציה עם הרשת, והיא הורדה בלבד: שום נתון של המשתמש לא נשלח.
 */
final class Updater {
    static final String SITE = "https://family-budget.naorkurtz1.workers.dev/";
    private static final String LIVE = "www-live";
    private static final String NEXT = "www-next";
    private static final String PREFS = "updater";

    interface Done {
        void updated(String version);
    }

    static File liveFile(Context ctx, String path) {
        return new File(new File(ctx.getFilesDir(), LIVE), path);
    }

    /** אחרי התקנת APK חדש, הקבצים הארוזים בו חדשים יותר מהמטמון: מוחקים את המטמון. */
    static void resetIfApkChanged(Context ctx) {
        try {
            long installed = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).lastUpdateTime;
            SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if (p.getLong("apk", 0) != installed) {
                delete(new File(ctx.getFilesDir(), LIVE));
                delete(new File(ctx.getFilesDir(), NEXT));
                p.edit().putLong("apk", installed).remove("version").apply();
            }
        } catch (Exception ignored) {
        }
    }

    static void checkInBackground(Context ctx, Done done) {
        new Thread(() -> {
            try {
                String version = check(ctx.getApplicationContext());
                if (version != null) done.updated(version);
            } catch (Exception ignored) {
                // אין רשת או שהאתר לא זמין: ממשיכים עם הגרסה הקיימת
            }
        }, "updater").start();
    }

    private static String check(Context ctx) throws Exception {
        JSONObject manifest = new JSONObject(new String(fetch("manifest.json"), StandardCharsets.UTF_8));
        String version = manifest.getString("version");
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (version.equals(prefs.getString("version", ""))) return null;

        JSONObject files = manifest.getJSONObject("files");
        File next = new File(ctx.getFilesDir(), NEXT);
        delete(next);
        List<String> changed = new ArrayList<>();
        for (Iterator<String> it = files.keys(); it.hasNext(); ) {
            String path = it.next();
            if (!path.matches("[A-Za-z0-9_./-]+") || path.contains("..") || path.startsWith("/")) throw new SecurityException(path);
            String want = files.getString(path);
            if (want.equals(currentHash(ctx, path))) continue;
            byte[] data = fetch(path);
            if (!want.equals(sha256(data))) throw new SecurityException("hash mismatch: " + path);
            File out = new File(next, path);
            out.getParentFile().mkdirs();
            try (FileOutputStream o = new FileOutputStream(out)) {
                o.write(data);
            }
            changed.add(path);
        }
        // רק אחרי שהכול ירד ואומת מעבירים למקום הפעיל
        for (String path : changed) {
            File to = liveFile(ctx, path);
            to.getParentFile().mkdirs();
            if (to.exists()) to.delete();
            if (!new File(next, path).renameTo(to)) throw new IllegalStateException("move failed: " + path);
        }
        delete(next);
        prefs.edit().putString("version", version).apply();
        return changed.isEmpty() ? null : version;
    }

    private static String currentHash(Context ctx, String path) {
        try {
            File live = liveFile(ctx, path);
            try (InputStream in = live.exists() ? new FileInputStream(live) : ctx.getAssets().open(path)) {
                return sha256(readAll(in));
            }
        } catch (Exception e) {
            return "";
        }
    }

    private static byte[] fetch(String path) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(SITE + path).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(20000);
        c.setUseCaches(false);
        try {
            if (c.getResponseCode() != 200) throw new IllegalStateException("HTTP " + c.getResponseCode() + " " + path);
            try (InputStream in = c.getInputStream()) {
                return readAll(in);
            }
        } finally {
            c.disconnect();
        }
    }

    private static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
        return out.toByteArray();
    }

    private static String sha256(byte[] data) throws Exception {
        StringBuilder sb = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(data)) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static void delete(File f) {
        if (f.isDirectory()) {
            File[] kids = f.listFiles();
            if (kids != null) for (File k : kids) delete(k);
        }
        f.delete();
    }
}
