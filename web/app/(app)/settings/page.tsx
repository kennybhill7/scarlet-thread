import { OfflineDownloads } from "@/components/settings/OfflineDownloads";
import styles from "./settings.module.css";

export default function SettingsPage() {
  return (
    <div className={styles.wrap}>
      <p className={styles.eyebrow}>Settings</p>
      <h1 className={styles.title}>Offline</h1>
      <OfflineDownloads />
    </div>
  );
}
