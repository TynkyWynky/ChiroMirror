const paths: Record<string, string> = {
  overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  posts: "M5 3h10l4 4v14H5z M14 3v5h5 M8 12h8 M8 16h6",
  messages: "M3 5h18v14H3z M3 6l9 7 9-7",
  finance: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
  home: "m3 10 9-7 9 7 M5 9v12h5v-7h4v7h5V9",
  groups: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M17 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  contact: "M8 3H5a2 2 0 0 0-2 2c0 9 7 16 16 16a2 2 0 0 0 2-2v-3l-5-2-2 2a13 13 0 0 1-6-6l2-2z",
  songs: "M9 18V5l12-2v13 M9 5v4l12-2 M9 18a3 3 0 1 1-3-3h3 M21 16a3 3 0 1 1-3-3h3",
  registration: "M5 4h14v17H5z M9 2v4h6V2 M8 11l2 2 5-5 M8 17h8",
  camp: "m2 21 10-18 10 18H2 M8 21l4-8 4 8",
  pages: "M8 3h12v14H8z M4 7v14h12",
  site: "M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M5.6 18.4l2.1-2.1 M16.3 7.7l2.1-2.1 M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0",
  team: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M19 8v6 M16 11h6",
  search: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0 M15 15l6 6",
  plus: "M12 5v14 M5 12h14",
  arrow: "M5 12h14 M14 7l5 5-5 5",
  back: "M19 12H5 M10 7l-5 5 5 5",
  external: "M14 3h7v7 M21 3 11 13 M10 3H3v18h18v-7",
  refresh: "M20 7a9 9 0 1 0 1 8 M20 3v5h-5",
  logout: "M9 3H3v18h6 M9 12h12 M17 8l4 4-4 4",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  close: "m6 6 12 12 M6 18 18 6",
  check: "m5 12 4 4L19 6",
  chevron: "m9 5 7 7-7 7"
};

export default function AdminIcon({ name }: { name: string }) {
  return <svg class="admin-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.pages} /></svg>;
}
