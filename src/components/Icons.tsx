import React from "react";
import Svg, { Path, Rect, Line, Circle, Polyline } from "react-native-svg";

interface IconProps {
  size?: number;
  color?: string;
}

// Tab bar icons — pulled from web app's BottomTabBar.tsx

export function FeedIcon({ size = 22, color }: IconProps) {
  // Lightning bolt — same as web's Feed tab
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </Svg>
  );
}

export function GamesIcon({ size = 22, color }: IconProps) {
  // Clock — same as web's Games tab
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="10" />
      <Path d="M12 6v6l4 2" />
    </Svg>
  );
}

export function MessagesIcon({ size = 22, color }: IconProps) {
  // Chat bubble — same as web's DMs tab
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" />
    </Svg>
  );
}

export function NotificationsIcon({ size = 22, color }: IconProps) {
  // Bell — same as web's Alerts tab
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <Path d="M13.73 21a2 2 0 01-3.46 0" />
    </Svg>
  );
}

export function ProfileIcon({ size = 22, color }: IconProps) {
  // Person — same as web's Profile tab
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="8" r="4" />
      <Path d="M20 21a8 8 0 10-16 0" />
    </Svg>
  );
}

// Post action icons — pulled from web app's SlipCard.tsx

export function HammerIcon({ size = 18, color, filled }: IconProps & { filled?: boolean }) {
  if (filled) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Rect x="2" y="4" width="14" height="6" rx="1" fill={color} />
        <Line x1="4" y1="7" x2="14" y2="7" stroke="rgba(0,0,0,0.2)" strokeWidth="1" />
        <Path d="M2 6.5L0.5 4.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
        <Rect x="10" y="10" width="3" height="12" rx="1" fill={color} />
        <Line x1="10.5" y1="14" x2="12.5" y2="14" stroke="rgba(0,0,0,0.15)" strokeWidth="1" />
        <Line x1="10.5" y1="17" x2="12.5" y2="17" stroke="rgba(0,0,0,0.15)" strokeWidth="1" />
        <Line x1="10.5" y1="20" x2="12.5" y2="20" stroke="rgba(0,0,0,0.15)" strokeWidth="1" />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="2" y="4" width="14" height="6" rx="1" stroke={color} strokeWidth="1.5" />
      <Path d="M2 6.5L0.5 4.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <Rect x="10" y="10" width="3" height="12" rx="1" stroke={color} strokeWidth="1.5" />
      <Line x1="10.5" y1="14" x2="12.5" y2="14" stroke={color} strokeWidth="1" opacity="0.5" />
      <Line x1="10.5" y1="17" x2="12.5" y2="17" stroke={color} strokeWidth="1" opacity="0.5" />
      <Line x1="10.5" y1="20" x2="12.5" y2="20" stroke={color} strokeWidth="1" opacity="0.5" />
    </Svg>
  );
}

export function TailIcon({ size = 18, color }: IconProps) {
  // Repost arrows — same as web's tail button
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="17 1 21 5 17 9" />
      <Path d="M3 11V9a4 4 0 014-4h14" />
      <Polyline points="7 23 3 19 7 15" />
      <Path d="M21 13v2a4 4 0 01-4 4H3" />
    </Svg>
  );
}

export function CommentIcon({ size = 18, color }: IconProps) {
  // Chat bubble — same as web's comment button
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" />
    </Svg>
  );
}

export function ChevronRight({ size = 16, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Path d="M9 5l7 7-7 7" />
    </Svg>
  );
}

export function BackArrow({ size = 22, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Path d="M19 12H5M12 19l-7-7 7-7" />
    </Svg>
  );
}
