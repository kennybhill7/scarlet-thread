import { DeviceSessionControls } from "@/components/auth/DeviceSessionControls";
import { VaultExportButton } from "@/components/export/VaultExportButton";
import { OfflineDownloads } from "@/components/settings/OfflineDownloads";
import styles from "./settings.module.css";

/**
 * Order is load-bearing and asserted by tests/protected-integrations.test.ts:
 * keep what you have (downloads), take it with you (export), then destroy it
 * (clear device). OfflineDownloads renders no heading of its own, hence the
 * wrapper section; the other two bring their own.
 */
export default function SettingsPage() {
  return (
    <div className={styles.wrap}>
      <p className={styles.eyebrow}>Settings</p>
      <h1 className={styles.title}>Your device</h1>
      <div className={styles.sections}>
        <section className={styles.card} aria-labelledby="offline-title">
          <p className={styles.cardEyebrow}>OFFLINE</p>
          <h2 id="offline-title" className={styles.cardTitle}>
            Downloads
          </h2>
          <OfflineDownloads />
        </section>
        <VaultExportButton />
        <DeviceSessionControls />
      </div>
    </div>
  );
}
