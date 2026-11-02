const paths = {
  plus: 'M12 5v14M5 12h14',
  send: 'M12 19V5M5.5 11.5 12 5l6.5 6.5',
  stop: 'M8 8h8v8H8z',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 4.5v5M10 14.5v5',
  chat: 'M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12Z',
  download: 'M12 4v11M7 10.5l5 5 5-5M5 20h14',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  close: 'M6 6l12 12M18 6 6 18',
  image: 'M4 5h16v14H4zM4 15l4.5-4.5L13 15M13 13l2.5-2.5L20 15M15.5 8.5h.01',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  left: 'm14.5 6-6 6 6 6',
  right: 'm9.5 6 6 6-6 6',
  trash: 'M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z',
  comment: 'M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12Z',
  share: 'M21 4 3 11l7 2.5L12.5 21 21 4ZM10 13.5 21 4',
  bookmark: 'M6 4h12v16l-6-4.5L6 20z',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  alert: 'M12 8v5M12 16.5h.01M10.3 4.3 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3.5 9h17M3.5 15h17M12 3c2.5 2.6 3.5 5.6 3.5 9s-1 6.4-3.5 9c-2.5-2.6-3.5-5.6-3.5-9s1-6.4 3.5-9Z',
  layers: 'm12 4 8 4-8 4-8-4 8-4ZM4 12l8 4 8-4M4 16l8 4 8-4',
  clock: 'M12 7.5V12l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  pin: 'M9 3.5h6l-1 6.5 3.5 3.5h-11L10 10 9 3.5ZM12 13.5V21',
  phone: 'M8 2.5h8a1 1 0 0 1 1 1v17a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1ZM11 18.5h2',
  text: 'M5 6h14M5 10h14M5 14h9M5 18h6',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z',
} as const;
export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
