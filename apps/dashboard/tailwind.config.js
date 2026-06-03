/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        terminal: {
          bg: "#0d1117",
          surface: "#161b22",
          border: "#21262d",
          muted: "#30363d",
          text: "#e6edf3",
          dim: "#7d8590",
          green: "#3fb950",
          red: "#f85149",
          orange: "#ff9900",
          blue: "#00d8ff",
          yellow: "#e3b341"
        }
      },
      fontFamily: {
        mono: ["'IBM Plex Mono'", "'Fira Code'", "ui-monospace", "monospace"]
      }
    }
  },
  plugins: []
};
