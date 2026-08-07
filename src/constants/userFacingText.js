export const userFacingText = {
  common: {
    jobAnalysisNotFound: 'No se encontro el analisis de la vacante.',
    resourceNotFound: 'No se encontro el recurso solicitado.',
    unexpectedServerError: 'Ocurrio un error inesperado en el servidor.',
  },
  draft: {
    blockedWarning: 'draft_blocked: la vacante contiene requisitos prohibidos o no verificados',
    recipientMissing: 'No se ve un correo de contacto en la fuente. No prepares el borrador de Gmail todavia.',
    noResumeSelected:
      'Todavia no se selecciono un CV para esta vacante. Selecciona el CV mas adecuado antes de enviar la postulacion.',
    selectedResume: (label) =>
      `CV seleccionado: ${label}. Antes de enviar, adjuntalo manualmente en Gmail.`,
    subject: (title) => `Postulacion para ${title} - Bryan Marquez`,
    greetingKnown: 'Hola,',
    greetingTeam: 'Hola equipo de seleccion,',
    intro: (title, company) =>
      `Mi nombre es Bryan Marquez y me interesa la oportunidad de ${title} en ${company}.`,
    closing:
      'Quedo a disposicion para continuar la conversacion y compartir la version de CV mas relevante para este rol.',
    farewell: 'Saludos cordiales,',
    remoteFit: 'Tambien me siento comodo trabajando en entornos remotos e hibridos.',
    techAligned: (technologies) =>
      `Mi stack confirmado incluye ${technologies.join(', ')}, en linea con los requisitos principales visibles en la vacante.`,
    roleAligned:
      'Mi experiencia confirmada y los proyectos publicados se alinean con el foco tecnico de esta vacante.',
    projects: (projects) =>
      `Entre los proyectos mas relevantes para este contexto se encuentran ${projects.join(' y ')}, donde aplique practicas de desarrollo backend y frontend con stacks basados en JavaScript.`,
  },
  guardrails: {
    salary: 'El salario es un dato sensible y requiere aprobacion manual.',
    workAuthorization: 'La autorizacion laboral debe revisarse manualmente.',
    relocation: 'La posibilidad de reubicacion requiere aprobacion explicita.',
    travel: 'La disponibilidad para viajar es sensible y debe revisarse.',
    immediateAvailability:
      'La disponibilidad inmediata debe confirmarse manualmente antes de preparar cualquier borrador.',
    legalQuestions: 'Las respuestas legales o de compliance no pueden completarse automaticamente.',
    advancedEnglish: 'La vacante exige ingles avanzado por encima del nivel B1 confirmado.',
    intermediateEnglish:
      'El requerimiento de ingles intermedio debe revisarse contra el nivel B1 confirmado.',
    yearsOfExperience: (years) =>
      `La vacante solicita ${years}+ anos de experiencia que no estan confirmados en el perfil del candidato.`,
    technologyClaim: (claim) =>
      `La vacante depende de una tecnologia con experiencia no verificada: ${claim}.`,
  },
  matching: {
    technologyConfirmed: (technology) =>
      `${technology} esta confirmado en el perfil del candidato.`,
    modalityAligned: 'La modalidad coincide con las preferencias laborales definidas.',
    roleAligned: 'El rol se alinea con las posiciones objetivo del perfil.',
    technologyMissing: (technology) =>
      `${technology} no esta confirmado en el perfil.`,
    advancedEnglishGap:
      'El requisito de ingles avanzado supera el nivel B1 confirmado.',
    seniorityGap:
      'La vacante apunta a seniority senior y el perfil actual esta orientado a roles junior.',
    salarySensitive: 'La expectativa salarial requiere revision manual antes de usarse.',
  },
};
