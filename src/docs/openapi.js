export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'JobPilot AI API',
    version: '0.1.0',
  },
  paths: {
    '/api/v1/health': {
      get: {
        summary: 'Operational health check with storage, queue, integration and circuit-breaker status',
        responses: {
          200: {
            description: 'Service status',
          },
        },
      },
    },
    '/api/v1/approvals': {
      get: {
        summary: 'List sensitive approval requests for manual review',
      },
    },
    '/api/v1/audits': {
      get: {
        summary: 'List recent audit events, optionally filtered by entity',
      },
    },
    '/api/v1/browser-sessions': {
      get: {
        summary: 'List supervised browser sessions',
      },
      post: {
        summary: 'Start a new supervised LinkedIn browser session for Jobs, Feed or post-search',
      },
    },
    '/api/v1/browser-sessions/{sessionId}': {
      get: {
        summary: 'Get a supervised browser session',
      },
    },
    '/api/v1/browser-sessions/{sessionId}/refresh': {
      post: {
        summary: 'Refresh the current supervised browser snapshot',
      },
    },
    '/api/v1/browser-sessions/{sessionId}/navigate': {
      post: {
        summary: 'Navigate a supervised browser session to another LinkedIn URL',
      },
    },
    '/api/v1/browser-sessions/{sessionId}/capture-job': {
      post: {
        summary:
          'Capture the visible LinkedIn Jobs offer or hiring publication from a supervised session into the intake pipeline',
      },
    },
    '/api/v1/browser-sessions/{sessionId}/close': {
      post: {
        summary: 'Close a supervised browser session',
      },
    },
    '/api/v1/approvals/{requestId}/approve': {
      post: {
        summary: 'Approve a sensitive approval request',
      },
    },
    '/api/v1/approvals/{requestId}/reject': {
      post: {
        summary: 'Reject a sensitive approval request',
      },
    },
    '/api/v1/answers': {
      get: {
        summary: 'List reusable answer-library entries',
      },
      post: {
        summary: 'Create a reusable answer-library entry',
      },
    },
    '/api/v1/answers/{answerId}': {
      put: {
        summary: 'Update a reusable answer-library entry',
      },
      delete: {
        summary: 'Delete a reusable answer-library entry',
      },
    },
    '/api/v1/jobs/manual': {
      post: {
        summary: 'Create a manual job offer analysis',
      },
    },
    '/api/v1/jobs': {
      get: {
        summary: 'List analyzed job offers',
      },
    },
    '/api/v1/jobs/{jobId}/draft-preview': {
      post: {
        summary: 'Generate a safe application draft preview for an analyzed job',
      },
    },
    '/api/v1/jobs/{jobId}/gmail-draft': {
      post: {
        summary: 'Create a Gmail draft from a reviewed job draft preview',
      },
    },
    '/api/v1/jobs/{jobId}/approve': {
      post: {
        summary: 'Approve a job that is awaiting human review',
      },
    },
    '/api/v1/jobs/{jobId}/reject': {
      post: {
        summary: 'Reject a job from the human approval queue',
      },
    },
    '/api/v1/jobs/{jobId}/select-resume': {
      post: {
        summary: 'Assign or clear the selected resume for a job offer',
      },
    },
    '/api/v1/resumes': {
      get: {
        summary: 'List local resume metadata',
      },
      post: {
        summary: 'Upload a local resume for manual later attachment',
      },
    },
    '/api/v1/integrations/gmail/status': {
      get: {
        summary: 'Get Gmail OAuth connection status',
      },
    },
    '/api/v1/integrations/gmail/auth-url': {
      get: {
        summary: 'Generate the Gmail OAuth consent URL',
      },
    },
    '/api/v1/integrations/gmail/callback': {
      get: {
        summary: 'Handle Gmail OAuth callback',
      },
    },
    '/api/v1/integrations/gmail/alerts': {
      get: {
        summary: 'List Gmail alert messages matching the configured query',
      },
    },
    '/api/v1/dashboard': {
      get: {
        summary: 'Dashboard summary',
      },
    },
  },
};
