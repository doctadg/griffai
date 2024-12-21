const config = {
    development: {
        wsUrl: `ws://${window.location.host}`
    },
    production: {
        wsUrl: 'ws://18.192.211.91:80'
    }
};

// Determine if we're in production based on hostname
const isProduction = !window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1');

// Export the appropriate configuration
export const wsUrl = isProduction ? config.production.wsUrl : config.development.wsUrl;