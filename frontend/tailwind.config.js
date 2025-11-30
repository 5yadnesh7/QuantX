/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        bg: "#020617",
        surface: "#0f172a",
        accent: "#38bdf8",
        accentSoft: "#0ea5e9",
        positive: "#22c55e",
        negative: "#ef4444"
      }
    },
  },
  plugins: [],
}

