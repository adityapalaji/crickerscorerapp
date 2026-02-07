/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // map the CSS variables from client/src/index.css to Tailwind color names
        border: "hsl(var(--color-border) / <alpha-value>)",
        input: "hsl(var(--color-input) / <alpha-value>)",
        ring: "hsl(var(--color-ring) / <alpha-value>)",
        background: "hsl(var(--color-background) / <alpha-value>)",
        foreground: "hsl(var(--color-foreground) / <alpha-value>)",
        card: "hsl(var(--color-card) / <alpha-value>)",
        "card-foreground": "hsl(var(--color-card-foreground) / <alpha-value>)",
        popover: "hsl(var(--color-popover) / <alpha-value>)",
        "popover-foreground":
          "hsl(var(--color-popover-foreground) / <alpha-value>)",
        primary: {
          DEFAULT: "hsl(var(--color-primary) / <alpha-value>)",
          foreground: "hsl(var(--color-primary-foreground) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "hsl(var(--color-secondary) / <alpha-value>)",
          foreground: "hsl(var(--color-secondary-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--color-muted) / <alpha-value>)",
          foreground: "hsl(var(--color-muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--color-accent) / <alpha-value>)",
          foreground: "hsl(var(--color-accent-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "hsl(var(--color-destructive) / <alpha-value>)",
          foreground:
            "hsl(var(--color-destructive-foreground) / <alpha-value>)",
        },
        "primary-border": "hsl(var(--color-primary-border) / <alpha-value>)",
        "accent-border": "hsl(var(--color-accent-border) / <alpha-value>)",
        "card-border": "hsl(var(--color-card-border) / <alpha-value>)",
      },
      borderRadius: {
        // optional: if your theme expects these variables
        lg: "var(--radius-lg)",
        md: "var(--radius-md)",
        sm: "var(--radius-sm)",
      },
    },
  },
  plugins: [
    // add any Tailwind plugins you need, e.g. tailwindcss-animate if used
    // require("tailwindcss-animate")
  ],
};
