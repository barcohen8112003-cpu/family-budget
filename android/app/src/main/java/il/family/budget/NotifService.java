package il.family.budget;

import android.app.Notification;
import android.content.Context;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/**
 * קולט התראות על עסקאות מחברות האשראי ומהבנקים (כולל SMS) ושומר אותן בתור מקומי.
 * האפליקציה מושכת את התור ומפענחת אותו ב-JavaScript. שום דבר לא נשלח החוצה.
 */
public class NotifService extends NotificationListenerService {
    private static final Object LOCK = new Object();
    private static final String FILE = "notif-queue.json";
    private static final int MAX = 500;

    // התראה רלוונטית: יש בה סכום בשקלים, והיא מזכירה בנק או חברת אשראי (בשם האפליקציה, בכותרת או בטקסט)
    private static final Pattern MONEY = Pattern.compile("(₪|ש\"ח|ש״ח|שח\\b|NIS|ILS)", Pattern.CASE_INSENSITIVE);
    private static final Pattern ISSUER = Pattern.compile(
            "כאל|כ\\.א\\.ל|\\bcal\\b|cal4u|מקס|\\bmax\\b|leumicard|ישראכרט|isracard|אמריקן אקספרס|amex|american express"
                    + "|לאומי|leumi|פועלים|poalim|דיסקונט|discount|מזרחי|טפחות|mizrahi|בינלאומי|fibi|פאגי|אוצר החייל|מרכנתיל|יהב|וואן זירו|one ?zero|פפר|pepper",
            Pattern.CASE_INSENSITIVE);

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            if (getPackageName().equals(sbn.getPackageName())) return;
            Bundle x = sbn.getNotification().extras;
            String title = str(x.getCharSequence(Notification.EXTRA_TITLE));
            CharSequence big = x.getCharSequence(Notification.EXTRA_BIG_TEXT);
            String text = str(big != null ? big : x.getCharSequence(Notification.EXTRA_TEXT));
            if (text.isEmpty() || !MONEY.matcher(text).find()) return;
            String where = sbn.getPackageName() + " " + title + " " + text;
            if (!ISSUER.matcher(where).find()) return;

            JSONObject o = new JSONObject();
            o.put("pkg", sbn.getPackageName());
            o.put("title", title);
            o.put("text", text);
            o.put("time", sbn.getPostTime());
            append(this, o);
        } catch (Exception ignored) {
            // התראה שלא ניתן לקרוא פשוט מדולגת
        }
    }

    private static String str(CharSequence c) {
        return c == null ? "" : c.toString().trim();
    }

    private static JSONArray read(Context ctx) {
        File f = new File(ctx.getFilesDir(), FILE);
        if (!f.exists()) return new JSONArray();
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[(int) f.length()];
            int n = in.read(buf);
            return new JSONArray(new String(buf, 0, Math.max(n, 0), StandardCharsets.UTF_8));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private static void write(Context ctx, JSONArray arr) throws Exception {
        try (FileOutputStream out = new FileOutputStream(new File(ctx.getFilesDir(), FILE))) {
            out.write(arr.toString().getBytes(StandardCharsets.UTF_8));
        }
    }

    private static void append(Context ctx, JSONObject o) throws Exception {
        synchronized (LOCK) {
            JSONArray arr = read(ctx);
            String text = o.getString("text");
            // אותה התראה מתפרסמת לפעמים כמה פעמים (עדכון, קיבוץ)
            for (int i = 0; i < arr.length(); i++) {
                JSONObject p = arr.getJSONObject(i);
                if (p.optString("text").equals(text) && p.optString("pkg").equals(o.getString("pkg"))
                        && Math.abs(p.optLong("time") - o.getLong("time")) < 10 * 60 * 1000L) return;
            }
            if (arr.length() >= MAX) arr.remove(0);
            arr.put(o);
            write(ctx, arr);
        }
    }

    /** מחזיר את התור כ-JSON ומרוקן אותו. */
    static String pull(Context ctx) {
        synchronized (LOCK) {
            JSONArray arr = read(ctx);
            if (arr.length() > 0) {
                try {
                    write(ctx, new JSONArray());
                } catch (Exception e) {
                    return "[]";
                }
            }
            return arr.toString();
        }
    }
}
