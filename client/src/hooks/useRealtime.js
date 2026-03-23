import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useStore } from '../context/store';

export function useRealtime(tableId) {
  const applyRemoteCell = useStore(s => s.applyRemoteCell);
  const socketRef       = useRef(null);
  const [collaborators, setCollaborators] = useState([]);

  useEffect(() => {
    const token = localStorage.getItem('gb_access');
    if (!token || !tableId) return;

    const socket = io('/', { auth: { token }, transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join:table', { tableId });
    });

    // Another user updated a cell
    socket.on('cell:updated', ({ recordId, fieldId, value, userId }) => {
      applyRemoteCell(recordId, fieldId, value);
    });

    // Presence
    socket.on('presence:current', (list) => setCollaborators(list));
    socket.on('presence:join',    (u)    => setCollaborators(c => [...c.filter(x => x.userId !== u.userId), u]));
    socket.on('presence:leave',   ({ userId }) => setCollaborators(c => c.filter(x => x.userId !== userId)));

    return () => {
      socket.emit('leave:table', { tableId });
      socket.disconnect();
    };
  }, [tableId]);

  // Call this whenever the local user updates a cell (broadcasts to others)
  const broadcastCellUpdate = (recordId, fieldId, value) => {
    socketRef.current?.emit('cell:update', { recordId, fieldId, value, tableId });
  };

  return { collaborators, broadcastCellUpdate };
}
