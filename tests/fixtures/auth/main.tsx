import { render } from "preact";
import AdminApp from "../../../src/components/admin/AdminApp";
import AdminAuthAction from "../../../src/components/admin/AdminAuthAction";
import "../../../public/assets/styles.css";
import "../../../public/assets/admin.css";

render(window.location.pathname.includes("auth-action")
  ? <AdminAuthAction adminBasePath="/fixture-app/" />
  : <AdminApp adminAuthActionPath="/fixture-app/auth-action/" />,
document.getElementById("fixture")!);
