import { heroui } from "@heroui/theme";
import type { Config } from "tailwindcss";

export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "./node_modules/@heroui/**/*.{js,mjs,cjs,ts,jsx,tsx}",
  ],
  darkMode: "class",
  plugins: [heroui({themes:{light:{colors:{primary:{DEFAULT:"#27272a",foreground:"#ffffff"}}},dark:{colors:{primary:{DEFAULT:"#f4f4f5",foreground:"#18181b"}}}}})],
} satisfies Config;
