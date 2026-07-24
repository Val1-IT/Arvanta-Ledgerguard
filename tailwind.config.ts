import type { Config } from 'tailwindcss';

// LedgerGuard design language: soft neo-brutalism.
// Cream/off-white surfaces, navy ink text and borders, amber/gold accent.
// Colour values are an independent reconstruction of the Arvanta look — no
// Arvanta source components are copied.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: {
          DEFAULT: '#F6F0E4',
          soft: '#EFE7D6',
          panel: '#FFFCF5',
          sunken: '#E8DDC9'
        },
        ink: {
          DEFAULT: '#1A1D24',
          muted: '#3F4656',
          subtle: '#5C6475'
        },
        gold: {
          DEFAULT: '#E8B441',
          strong: '#9A6B10',
          soft: 'rgba(184, 134, 28, 0.16)'
        },
        healthy: '#3F7150',
        risk: '#B54B31',
        warn: '#9A6B10'
      },
      borderColor: {
        ink: 'rgba(26, 29, 36, 0.72)'
      },
      boxShadow: {
        // Hard offset shadow, no blur — neo-brutalist.
        brutal: '4px 4px 0 0 #1A1D24',
        'brutal-sm': '2px 2px 0 0 #1A1D24',
        'brutal-gold': '4px 4px 0 0 #9A6B10'
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      }
    }
  },
  plugins: []
};

export default config;
