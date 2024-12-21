// Get the WebSocket protocol based on page protocol
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

const config = {
    development: {
        wsUrl: `${wsProtocol}//${window.location.host}`
    },
    production: {
        wsUrl: `${wsProtocol}//${window.location.hostname}`
    }
};

// Determine if we're in production based on hostname
const isProduction = !window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1');

// Export the appropriate configuration
export const wsUrl = isProduction ? config.production.wsUrl : config.development.wsUrl;