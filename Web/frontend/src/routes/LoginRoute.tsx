import { Navigate } from "react-router-dom";
import { isCentralSso } from "@/lib/authMode";
import LoginPage from "@/pages/LoginPage";

/**
 * MCP's normal login page (direct access), except inside DeoDap Central, where there is never a
 * login page: sign-in happens in Central (the door is detected at runtime, see lib/authMode).
 */
export function LoginRoute() {
  return isCentralSso() ? <Navigate to="/" replace /> : <LoginPage />;
}
