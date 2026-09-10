-- Backfill: give every graph-less workflow its trigger node.
--
-- `createWorkflow` inserted the row with no graph at all, while the canvas
-- keeps `trigger` out of its node palette on the assumption that creation had
-- already placed exactly one. Neither half was wrong on its own; together they
-- meant every workflow ever created opened on "The workflow needs a trigger to
-- start from" with no control anywhere that could add one. Nodes could be
-- dropped on the canvas but never connected to a start, so no workflow was
-- completable and none could run.
--
-- The action now seeds the node. This does the same for rows that already
-- exist, which would otherwise stay stuck forever.
--
-- Only touches workflows with no nodes: a graph someone has actually built is
-- left exactly as it is, including one that already has a trigger.
UPDATE workflows
SET graph = jsonb_build_object(
      'nodes', jsonb_build_array(
        jsonb_build_object(
          'id', 'trigger',
          'type', 'trigger',
          'config', jsonb_build_object('trigger_type', trigger_type),
          'position', jsonb_build_object('x', 24, 'y', 24)
        )
      ),
      'edges', '[]'::jsonb
    )
WHERE COALESCE(jsonb_array_length(
        CASE WHEN jsonb_typeof(graph -> 'nodes') = 'array' THEN graph -> 'nodes' ELSE '[]'::jsonb END
      ), 0) = 0;
