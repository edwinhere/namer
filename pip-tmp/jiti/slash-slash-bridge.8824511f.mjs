"use strict";Object.defineProperty(exports, "__esModule", { value: true });exports.registerSlashSubagentBridge = registerSlashSubagentBridge;


var _types = await jitiImport("../shared/types.ts");












































function registerSlashSubagentBridge(options)


{
  const controllers = new Map();
  const pendingCancels = new Set();
  const subscriptions = [];

  const subscribe = (event, handler) => {
    const unsubscribe = options.events.on(event, handler);
    if (typeof unsubscribe === "function") subscriptions.push(unsubscribe);
  };

  subscribe(_types.SLASH_SUBAGENT_CANCEL_EVENT, (data) => {
    if (!data || typeof data !== "object") return;
    const requestId = data.requestId;
    if (typeof requestId !== "string") return;
    const controller = controllers.get(requestId);
    if (controller) {
      controller.abort();
      return;
    }
    pendingCancels.add(requestId);
  });

  subscribe(_types.SLASH_SUBAGENT_REQUEST_EVENT, async (data) => {
    if (!data || typeof data !== "object") return;
    const request = data;
    if (typeof request.requestId !== "string" || !request.params) return;
    const { requestId, params } = request;

    const ctx = options.getContext();
    if (!ctx) {
      const response = {
        requestId,
        result: {
          content: [{ type: "text", text: "No active extension context for slash subagent execution." }],
          details: { mode: "single", results: [] }
        },
        isError: true,
        errorText: "No active extension context."
      };
      options.events.emit(_types.SLASH_SUBAGENT_RESPONSE_EVENT, response);
      return;
    }

    const controller = new AbortController();
    controllers.set(requestId, controller);

    if (pendingCancels.delete(requestId)) {
      controller.abort();
      const response = {
        requestId,
        result: {
          content: [{ type: "text", text: "Cancelled." }],
          details: { mode: "single", results: [] }
        },
        isError: true,
        errorText: "Cancelled before start."
      };
      options.events.emit(_types.SLASH_SUBAGENT_RESPONSE_EVENT, response);
      controllers.delete(requestId);
      return;
    }

    options.events.emit(_types.SLASH_SUBAGENT_STARTED_EVENT, { requestId });

    try {
      const result = await options.execute(
        requestId,
        params,
        controller.signal,
        (update) => {
          const progress = update.details?.progress;
          const first = progress?.[0];
          const payload = {
            requestId,
            progress,
            currentTool: first?.currentTool,
            toolCount: first?.toolCount
          };
          options.events.emit(_types.SLASH_SUBAGENT_UPDATE_EVENT, payload);
        },
        ctx
      );

      const response = {
        requestId,
        result,
        isError: result.isError === true,
        errorText: result.isError ?
        result.content.find((c) => c.type === "text")?.text :
        undefined
      };
      options.events.emit(_types.SLASH_SUBAGENT_RESPONSE_EVENT, response);
    } catch (error) {
      const response = {
        requestId,
        result: {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          details: { mode: "single", results: [] }
        },
        isError: true,
        errorText: error instanceof Error ? error.message : String(error)
      };
      options.events.emit(_types.SLASH_SUBAGENT_RESPONSE_EVENT, response);
    } finally {
      controllers.delete(requestId);
    }
  });

  return {
    cancelAll: () => {
      for (const controller of controllers.values()) {
        controller.abort();
      }
      controllers.clear();
      pendingCancels.clear();
    },
    dispose: () => {
      for (const unsubscribe of subscriptions) unsubscribe();
      subscriptions.length = 0;
      pendingCancels.clear();
    }
  };
} /* v9-6c66ea21e5f2369a */
