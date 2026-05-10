import animate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(215 30% 8%)",
        foreground: "hsl(210 18% 92%)",
        card: "hsl(217 28% 11%)",
        "card-foreground": "hsl(210 18% 92%)",
        popover: "hsl(217 28% 11%)",
        "popover-foreground": "hsl(210 18% 92%)",
        primary: "hsl(194 91% 48%)",
        "primary-foreground": "hsl(210 30% 8%)",
        secondary: "hsl(218 24% 18%)",
        "secondary-foreground": "hsl(210 18% 92%)",
        muted: "hsl(218 22% 15%)",
        "muted-foreground": "hsl(214 15% 66%)",
        accent: "hsl(162 85% 40%)",
        "accent-foreground": "hsl(210 30% 8%)",
        destructive: "hsl(0 72% 55%)",
        "destructive-foreground": "hsl(210 18% 92%)",
        border: "hsl(218 20% 20%)",
        input: "hsl(218 20% 20%)",
        ring: "hsl(194 91% 48%)"
      },
      borderRadius: {
        lg: "0.75rem",
        md: "0.625rem",
        sm: "0.5rem"
      },
      fontFamily: {
        sans: ["'IBM Plex Sans'", "system-ui", "sans-serif"]
      },
      boxShadow: {
        panel: "0 20px 60px rgba(3, 12, 24, 0.35)"
      },
      backgroundImage: {
        mesh: "radial-gradient(circle at top, rgba(34,211,238,0.14), transparent 34%), radial-gradient(circle at 80% 20%, rgba(16,185,129,0.10), transparent 26%), linear-gradient(180deg, rgba(9,14,24,0.96), rgba(6,10,18,1))"
      }
    }
  },
  plugins: [animate]
};
