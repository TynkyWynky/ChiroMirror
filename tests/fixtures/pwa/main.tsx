import { render } from "preact";
import AdminApp from "../../../src/components/admin/AdminApp";
import { captureInstallPrompt } from "../../../src/features/app/pwa/install";
import "../../../public/assets/styles.css";
import "../../../public/assets/admin.css";
captureInstallPrompt();
render(<AdminApp adminAuthActionPath="/fixture-app/auth-action/"/>,document.getElementById('fixture')!);
