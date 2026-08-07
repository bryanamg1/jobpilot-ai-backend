export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'JobPilot AI API',
    version: '0.1.0',
  },
  paths: {
    '/api/v1/health': {
      get: {
        summary: 'Verifica el estado operativo con almacenamiento, cola, integraciones y circuit breakers',
        responses: {
          200: {
            description: 'Estado del servicio',
          },
        },
      },
    },
    '/api/v1/approvals': {
      get: {
        summary: 'Lista solicitudes de aprobacion sensible para revision manual',
      },
    },
    '/api/v1/audits': {
      get: {
        summary: 'Lista eventos recientes de auditoria, con filtro opcional por entidad',
      },
    },
    '/api/v1/browser-sessions': {
      get: {
        summary: 'Lista sesiones supervisadas del navegador',
      },
      post: {
        summary: 'Inicia una nueva sesion supervisada de LinkedIn para Jobs, Feed o busqueda de publicaciones',
      },
    },
    '/api/v1/browser-sessions/{sessionId}': {
      get: {
        summary: 'Obtiene una sesion supervisada del navegador',
      },
    },
    '/api/v1/browser-sessions/{sessionId}/refresh': {
      post: {
        summary: 'Refresca la captura actual de la sesion supervisada',
      },
    },
    '/api/v1/browser-sessions/{sessionId}/navigate': {
      post: {
        summary: 'Navega una sesion supervisada hacia otra URL de LinkedIn',
      },
    },
    '/api/v1/browser-sessions/{sessionId}/capture-job': {
      post: {
        summary:
          'Captura la oferta visible de LinkedIn Jobs o una publicacion de hiring desde una sesion supervisada hacia el pipeline de ingreso',
      },
    },
    '/api/v1/browser-sessions/{sessionId}/close': {
      post: {
        summary: 'Cierra una sesion supervisada del navegador',
      },
    },
    '/api/v1/automation/settings': {
      get: {
        summary: 'Obtiene la configuracion persistida del runner diario en DRY_RUN',
      },
      put: {
        summary: 'Actualiza la configuracion persistida del runner diario en DRY_RUN',
      },
    },
    '/api/v1/automation/runs': {
      post: {
        summary: 'Dispara un ciclo manual DRY_RUN usando la configuracion persistida',
      },
    },
    '/api/v1/approvals/{requestId}/approve': {
      post: {
        summary: 'Aprueba una solicitud de aprobacion sensible',
      },
    },
    '/api/v1/approvals/{requestId}/reject': {
      post: {
        summary: 'Rechaza una solicitud de aprobacion sensible',
      },
    },
    '/api/v1/answers': {
      get: {
        summary: 'Lista respuestas reutilizables de la biblioteca',
      },
      post: {
        summary: 'Crea una respuesta reutilizable en la biblioteca',
      },
    },
    '/api/v1/answers/{answerId}': {
      put: {
        summary: 'Actualiza una respuesta reutilizable de la biblioteca',
      },
      delete: {
        summary: 'Elimina una respuesta reutilizable de la biblioteca',
      },
    },
    '/api/v1/jobs/manual': {
      post: {
        summary: 'Crea un analisis manual de una vacante',
      },
    },
    '/api/v1/jobs': {
      get: {
        summary: 'Lista vacantes analizadas',
      },
    },
    '/api/v1/jobs/{jobId}/draft-preview': {
      post: {
        summary: 'Genera una vista previa segura de postulacion para una vacante analizada',
      },
    },
    '/api/v1/jobs/{jobId}/gmail-draft': {
      post: {
        summary: 'Crea un borrador de Gmail a partir de una vista previa ya revisada',
      },
    },
    '/api/v1/jobs/{jobId}/dry-run-application': {
      post: {
        summary: 'Ejecuta una simulacion manual DRY_RUN para una vacante analizada',
      },
    },
    '/api/v1/jobs/{jobId}/approve': {
      post: {
        summary: 'Aprueba una vacante que espera revision humana',
      },
    },
    '/api/v1/jobs/{jobId}/reject': {
      post: {
        summary: 'Rechaza una vacante desde la bandeja de aprobacion humana',
      },
    },
    '/api/v1/jobs/{jobId}/select-resume': {
      post: {
        summary: 'Asigna o limpia el CV seleccionado para una vacante',
      },
    },
    '/api/v1/resumes': {
      get: {
        summary: 'Lista metadatos locales de CVs',
      },
      post: {
        summary: 'Sube un CV local para adjuntarlo manualmente mas adelante',
      },
    },
    '/api/v1/integrations/gmail/status': {
      get: {
        summary: 'Obtiene el estado de conexion OAuth de Gmail',
      },
    },
    '/api/v1/integrations/gmail/auth-url': {
      get: {
        summary: 'Genera la URL de consentimiento OAuth de Gmail',
      },
    },
    '/api/v1/integrations/gmail/callback': {
      get: {
        summary: 'Procesa el callback OAuth de Gmail',
      },
    },
    '/api/v1/integrations/gmail/alerts': {
      get: {
        summary: 'Lista alertas de Gmail que coinciden con la consulta configurada',
      },
    },
    '/api/v1/dashboard': {
      get: {
        summary: 'Resumen del dashboard',
      },
    },
  },
};
