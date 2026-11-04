import server from '../dist/index.js';

export default function handler(request, response) {
  server.emit('request', request, response);
}
