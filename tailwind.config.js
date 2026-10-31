/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        sos: {
          critical: "#ef4444",
          high: "#f97316",
          elevated: "#eab308",
          standard: "#3b82f6",
        },
      },
    },
  },
  plugins: [],
};

