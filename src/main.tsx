import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";

// CSS 加载顺序有讲究：Tailwind preflight → HeroUI → 应用自定义变量/覆盖
import "@/globals.css";
import "@heroui/react/styles";
import "@/legacy-global.css";

import { Providers } from "@/components/providers/Providers";
import { MotionProvider } from "@/components/motion/MotionProvider";
import { AppShell } from "@/components/shell/AppShell";
import { DouyuHomePage } from "@/screens/DouyuHomePage";
import { DouyinHomePage } from "@/screens/DouyinHomePage";
import { HuyaHomePage } from "@/screens/HuyaHomePage";
import { BilibiliHomePage } from "@/screens/BilibiliHomePage";
import { CustomHomePage } from "@/screens/CustomHomePage";
import { PlayerRoute } from "@/routes/PlayerRoute";

function AppRoutes() {
  const { pathname } = useLocation();
  // 统一去掉尾斜杠，保证下面的精确路由一定匹配（/douyin/ → /douyin）
  if (pathname !== "/" && pathname.endsWith("/")) {
    return <Navigate to={pathname.replace(/\/+$/, "")} replace />;
  }
  return (
    <Routes>
      <Route path="/" element={<DouyuHomePage />} />
      <Route path="/douyin" element={<DouyinHomePage />} />
      <Route path="/huya" element={<HuyaHomePage />} />
      <Route path="/bilibili" element={<BilibiliHomePage />} />
      <Route path="/custom" element={<CustomHomePage />} />
      <Route path="/player" element={<PlayerRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <HashRouter>
    <Providers>
      <MotionProvider>
        <AppShell>
          <AppRoutes />
        </AppShell>
      </MotionProvider>
    </Providers>
  </HashRouter>
);
