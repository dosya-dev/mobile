import type { ComponentType } from "react";
import { View } from "react-native";
import {
  Ban, Bell, Calendar, CalendarClock, CircleCheck, CirclePause, CircleStop, CircleX, Clock,
  CloudDownload, CloudOff, Copy, CreditCard, Crown, Database, Download, Eye, FileClock,
  FileText, Flame, Folder, FolderOpen, Gift, HardDrive, Hourglass, Inbox, KeyRound, LifeBuoy,
  Link, List, ListOrdered, Lock, LockKeyholeOpen, LockOpen, LogOut, Mail, MailCheck,
  MessageSquare, MessageSquareReply, MonitorSmartphone, Package, Plug, Recycle, RefreshCw,
  RotateCcw, RotateCw, Send, Server, Settings, Share2, Shield, ShieldAlert, ShieldCheck,
  ShieldOff, Sparkles, Ticket, TicketCheck, Trash, TrendingUp, TriangleAlert, Undo2, Unplug,
  Upload, UserCheck, UserCog, UserMinus, UserPlus, UserRound, UserX, UsersRound, Webhook,
  WebhookOff, Wrench,
} from "lucide-react-native";
import { useColorTheme } from "@/theme/useColorTheme";
import {
  NOTIFICATION_ICON_KEYS,
  notificationTone,
  resolveNotificationIcon,
  type NotificationIconKey,
} from "./icons.generated";

type Glyph = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

/**
 * Every icon key the API can write, as the Lucide component that draws it. Same
 * table as web and desktop, so a notification is the same picture on every
 * dosya. `Record<NotificationIconKey, …>` makes a key with no drawing a type
 * error; the key list itself is a generated copy of packages/shared.
 */
export const NOTIFICATION_ICON_COMPONENTS: Record<NotificationIconKey, Glyph> = {
  "bell": Bell,
  "shield": Shield,
  "shield-alert": ShieldAlert,
  "shield-check": ShieldCheck,
  "shield-off": ShieldOff,
  "key-round": KeyRound,
  "lock": Lock,
  "lock-open": LockOpen,
  "lock-keyhole-open": LockKeyholeOpen,
  "monitor-smartphone": MonitorSmartphone,
  "mail": Mail,
  "mail-check": MailCheck,
  "list-ordered": ListOrdered,
  "log-out": LogOut,
  "life-buoy": LifeBuoy,
  "triangle-alert": TriangleAlert,
  "user-round": UserRound,
  "users-round": UsersRound,
  "user-plus": UserPlus,
  "user-minus": UserMinus,
  "user-x": UserX,
  "user-check": UserCheck,
  "user-cog": UserCog,
  "crown": Crown,
  "settings": Settings,
  "wrench": Wrench,
  "package": Package,
  "calendar": Calendar,
  "calendar-clock": CalendarClock,
  "clock": Clock,
  "hourglass": Hourglass,
  "circle-check": CircleCheck,
  "circle-x": CircleX,
  "circle-stop": CircleStop,
  "circle-pause": CirclePause,
  "trash": Trash,
  "flame": Flame,
  "folder": Folder,
  "folder-open": FolderOpen,
  "link": Link,
  "share-2": Share2,
  "eye": Eye,
  "trending-up": TrendingUp,
  "download": Download,
  "upload": Upload,
  "file-clock": FileClock,
  "file-text": FileText,
  "rotate-ccw": RotateCcw,
  "list": List,
  "copy": Copy,
  "inbox": Inbox,
  "undo-2": Undo2,
  "message-square": MessageSquare,
  "message-square-reply": MessageSquareReply,
  "refresh-cw": RefreshCw,
  "rotate-cw": RotateCw,
  "cloud-download": CloudDownload,
  "cloud-off": CloudOff,
  "plug": Plug,
  "unplug": Unplug,
  "webhook": Webhook,
  "webhook-off": WebhookOff,
  "database": Database,
  "credit-card": CreditCard,
  "hard-drive": HardDrive,
  "gift": Gift,
  "ban": Ban,
  "ticket": Ticket,
  "ticket-check": TicketCheck,
  "recycle": Recycle,
  "send": Send,
  "sparkles": Sparkles,
  "server": Server,
};

export const KNOWN_ICON_KEYS = NOTIFICATION_ICON_KEYS;

/** Mixes a hex colour toward transparent. The ring is the glyph's own colour at 45%. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  return `${hex}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
}

/**
 * The inbox row's glyph: a hairline ring around a 16px line icon. Unread
 * sharpens the ring and glyph to the foreground colour, important takes the
 * warning hue, critical the destructive hue, everything else stays muted.
 */
export function NotificationIcon({
  icon, category, priority, unread = false, size = 32,
}: {
  icon: string | null | undefined;
  category: string | null | undefined;
  priority: string | null | undefined;
  unread?: boolean;
  size?: number;
}) {
  const { tokens } = useColorTheme();
  const key = resolveNotificationIcon(icon, category);
  const tone = notificationTone(priority);
  const Glyph = NOTIFICATION_ICON_COMPONENTS[key];
  const color =
    tone === "critical" ? tokens.destructive
    : tone === "important" ? tokens.warning
    : unread ? tokens.foreground
    : tokens.mutedForeground;
  const emphasised = tone !== "normal" || unread;
  return (
    <View
      testID={`notification-icon-${key}`}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        borderWidth: 1,
        borderColor: emphasised ? withAlpha(color, 0.45) : tokens.border,
      }}
    >
      <Glyph size={Math.round(size / 2)} color={color} strokeWidth={1.75} />
    </View>
  );
}
