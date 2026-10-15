import SettingsPageContent from "./components/settings-page-content";
import { readSettingsShape } from "./read-settings-shape";

export default async function SettingsPage() {
  return <SettingsPageContent shape={await readSettingsShape()} />;
}
