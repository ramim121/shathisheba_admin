/** Tailwind v4 runs as a PostCSS plugin; see app/globals.css for why only its
    theme and utility layers are imported (no Preflight). */
const config = {
  plugins: {
    "@tailwindcss/postcss": {}
  }
};

export default config;
