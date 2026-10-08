import { useEffect, useCallback } from 'react';

interface KeyboardShortcutsProps {
  onTogglePauseResume?: () => void;
  onTriggerDisposition?: () => void;
  onToggleHelp?: () => void;
  onCloseModal?: () => void;
  onToggleAIChat?: () => void;
  onToggleLiveVoice?: () => void;
  onToggleSavedLeads?: () => void;
  onSelectTab?: (tab: string) => void;
  enabled?: boolean;
}

export function useKeyboardShortcuts({
  onTogglePauseResume,
  onTriggerDisposition,
  onToggleHelp,
  onCloseModal,
  onToggleAIChat,
  onToggleLiveVoice,
  onToggleSavedLeads,
  onSelectTab,
  enabled = true,
}: KeyboardShortcutsProps) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      const target = event.target as HTMLElement | null;
      const isInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;

      // Escape always works, even from inputs to dismiss modals/focus
      if (event.key === 'Escape') {
        if (onCloseModal) {
          event.preventDefault();
          onCloseModal();
          return;
        }
      }

      // Do not trigger other global shortcuts if user is typing in notes/inputs
      if (isInput) {
        return;
      }

      // '?' key (or Shift + /) to toggle Keyboard Help Modal
      if (event.key === '?' || (event.shiftKey && event.key === '/')) {
        if (onToggleHelp) {
          event.preventDefault();
          onToggleHelp();
          return;
        }
      }

      // Space key: Toggle session pause/resume
      if (event.code === 'Space' || event.key === ' ') {
        if (onTogglePauseResume) {
          event.preventDefault();
          onTogglePauseResume();
          return;
        }
      }

      // D key: Trigger disposition submission flow for active call
      if (event.key === 'd' || event.key === 'D') {
        if (onTriggerDisposition) {
          event.preventDefault();
          onTriggerDisposition();
          return;
        }
      }

      // C key: Toggle AI Copilot Chat Drawer
      if ((event.key === 'c' || event.key === 'C') && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (onToggleAIChat) {
          event.preventDefault();
          onToggleAIChat();
          return;
        }
      }

      // L key: Toggle Live Voice Modal
      if ((event.key === 'l' || event.key === 'L') && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (onToggleLiveVoice) {
          event.preventDefault();
          onToggleLiveVoice();
          return;
        }
      }

      // S key: Toggle Saved Leads Drawer
      if ((event.key === 's' || event.key === 'S') && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (onToggleSavedLeads) {
          event.preventDefault();
          onToggleSavedLeads();
          return;
        }
      }

      // Alt + 1-5 Tab Switching
      if (event.altKey && onSelectTab) {
        if (event.key === '1') {
          event.preventDefault();
          onSelectTab('workspace');
        } else if (event.key === '2') {
          event.preventDefault();
          onSelectTab('campaigns');
        } else if (event.key === '3') {
          event.preventDefault();
          onSelectTab('suppression');
        } else if (event.key === '4') {
          event.preventDefault();
          onSelectTab('architecture');
        } else if (event.key === '5') {
          event.preventDefault();
          onSelectTab('telephony');
        }
      }
    },
    [
      onTogglePauseResume,
      onTriggerDisposition,
      onToggleHelp,
      onCloseModal,
      onToggleAIChat,
      onToggleLiveVoice,
      onToggleSavedLeads,
      onSelectTab,
      enabled,
    ]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);
}

