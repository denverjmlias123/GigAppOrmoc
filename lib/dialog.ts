import { showConfirmDialog } from '../components/ui/ConfirmDialog';

/**
 * Universal in-app confirmation modal.
 * Works seamlessly on Web (PC/Laptop/Mobile) and Native (iOS/Android) via in-app Modal.
 */
export function confirmDialog(options: {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}): Promise<boolean> {
  return showConfirmDialog(options);
}
