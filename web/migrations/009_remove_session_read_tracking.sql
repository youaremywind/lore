-- Migration 009: Remove per-session read tracking state.

DROP TABLE IF EXISTS session_read_nodes;

DELETE FROM app_settings
WHERE key IN (
  'recall.display.read_node_display_mode',
  'policy.read_before_modify_enabled',
  'policy.read_before_modify_window_minutes'
);
