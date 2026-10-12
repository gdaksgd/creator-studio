import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * 合并类名：clsx 处理条件类名，tailwind-merge 处理冲突
 * （例如 cn('px-4', 'px-2') → 'px-2'，避免后写的样式被前面的覆盖掉）
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
