import { RouterProvider } from "react-router-dom";
import { router } from "@/routes/router";
import { useApplyTheme } from "@/store/theme.store";

export default function App() {
  useApplyTheme(); // applies the persisted dark/light theme to <html>
  return <RouterProvider router={router} />;
}
