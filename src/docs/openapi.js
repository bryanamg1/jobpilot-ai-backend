export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'JobPilot AI API',
    version: '0.1.0',
  },
  paths: {
    '/api/v1/health': {
      get: {
        summary: 'Health check',
        responses: {
          200: {
            description: 'Service status',
          },
        },
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
