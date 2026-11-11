// Local PeerJS signaling server for development/testing:
//   npm run signal   then open http://localhost:5173/?peer=localhost:9000
import { PeerServer } from 'peer';

const port = Number(process.env.PORT) || 9000;
PeerServer({ port, path: '/', host: process.env.HOST || '0.0.0.0' }, () => console.log(`PeerJS signaling server on :${port}`));
