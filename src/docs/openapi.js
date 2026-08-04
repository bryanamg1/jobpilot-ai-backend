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
    '/api/v1/dashboard': {
      get: {
        summary: 'Dashboard summary',
      },
    },
  },
};
