package il.family.budget;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;

import java.io.OutputStream;

/**
 * עדכון האפליקציה עצמה (APK) מתוך האפליקציה: מוריד את הגרסה החדשה מהשרת, בודק שהקובץ שלם,
 * ומעביר אותו למתקין של אנדרואיד, שמציג למשתמש את חלון "לעדכן את האפליקציה?".
 * אנדרואיד מתקין רק APK שחתום באותו מפתח כמו האפליקציה הקיימת, והנתונים נשמרים.
 */
final class AppUpdater {
    static final String APK_PATH = "apk/family-budget.apk";
    static final String ACTION = "il.family.budget.INSTALL_RESULT";

    interface Report {
        void report(String state, String message);
    }

    static void install(Context ctx, String sha256, Report report) {
        new Thread(() -> {
            try {
                report.report("downloading", "");
                String apkPath = ctx.getPackageName().endsWith(".admin") ? "apk/family-budget-admin.apk" : APK_PATH;
                byte[] apk = Updater.fetch(apkPath);
                if (!Updater.sha256(apk).equalsIgnoreCase(sha256)) throw new SecurityException("הקובץ שהורד פגום. נסו שוב.");
                PackageInstaller installer = ctx.getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                params.setAppPackageName(ctx.getPackageName());
                int id = installer.createSession(params);
                try (PackageInstaller.Session session = installer.openSession(id)) {
                    try (OutputStream out = session.openWrite("app.apk", 0, apk.length)) {
                        out.write(apk);
                        session.fsync(out);
                    }
                    Intent result = new Intent(ACTION).setPackage(ctx.getPackageName());
                    int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                    session.commit(PendingIntent.getBroadcast(ctx, id, result, flags).getIntentSender());
                }
                report.report("confirm", "");
            } catch (Exception e) {
                report.report("error", e.getMessage() == null ? e.toString() : e.getMessage());
            }
        }, "app-updater").start();
    }
}
