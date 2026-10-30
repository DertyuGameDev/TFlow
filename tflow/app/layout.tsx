import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ТФлоу — мероприятия и люди",
  description: "Находите мероприятия, выбирайте активности и составляйте своё расписание без пересечений.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
