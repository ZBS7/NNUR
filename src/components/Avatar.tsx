import React from 'react';

const COLORS = [
  '#6C63FF','#FF6B9D','#F7B731','#26de81','#2BCBBA',
  '#FC5C65','#45AAF2','#A55EEA','#FD9644','#2ECC71',
];

interface AvatarProps {
  src?: string;
  name: string;
  size?: number;
  online?: boolean;
  connecting?: boolean;
}

export default function Avatar({ src, name, size = 46, online, connecting }: AvatarProps) {
  const color = COLORS[(name.charCodeAt(0) || 65) % COLORS.length];
  const fontSize = Math.round(size * 0.38);

  return (
    <div className="chat-item-av" style={{ position: 'relative', flexShrink: 0 }}>
      <div
        className="av"
        style={{
          width: size, height: size,
          background: src ? undefined : `linear-gradient(135deg, ${color}, ${color}bb)`,
          fontSize,
          boxShadow: src ? undefined : `0 2px 8px ${color}44`,
        }}
      >
        {src ? <img src={src} alt={name} /> : name.charAt(0).toUpperCase()}
      </div>
      {online && <span className="online-dot" />}
      {!online && connecting && <span className="connecting-dot" />}
    </div>
  );
}
