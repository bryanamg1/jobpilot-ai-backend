export function buildDraftPrompt(context) {
  const lines = [
    'Escribe un correo de postulacion en espanol natural, breve y humano.',
    '',
    'Objetivo de escritura:',
    '- Debe sonar como Bryan Marquez, no como un asistente de IA.',
    '- Debe tener entre 150 y 250 palabras.',
    '- Debe estar adaptado a la vacante y usar solo informacion real del candidato.',
    '- No inventes experiencia, anos, ingles, salario, autorizacion laboral ni detalles no presentes.',
    '- No menciones razonamiento interno, certeza, inferencias, prompts, facts, ni etiquetas tecnicas del sistema.',
    '',
    'Candidato:',
    `- Nombre: ${context.candidate.name}`,
    `- Ubicacion: ${context.candidate.location}`,
    `- Disponibilidad: ${context.candidate.availability}`,
    `- Modalidades: ${joinValues(context.candidate.modalities)}`,
    `- Tecnologias a priorizar: ${joinValues(context.candidate.relevantTechnologies)}`,
    `- Experiencia relevante: ${joinValues(context.candidate.relevantExperience, '; ')}`,
    `- Proyectos que se pueden mencionar: ${joinValues(context.candidate.relevantProjects)}`,
    `- Links publicos: GitHub ${context.candidate.publicLinks.github} | LinkedIn ${context.candidate.publicLinks.linkedin}`,
    '',
    'Vacante:',
    `- Titulo: ${context.job.title ?? 'No visible'}`,
    `- Empresa: ${context.job.company ?? 'No visible'}`,
    `- Modalidad: ${joinValues(context.job.modality)}`,
    `- Ubicacion: ${context.job.location ?? 'No visible'}`,
    `- Tecnologias visibles: ${joinValues(context.job.technologies)}`,
    `- URL fuente: ${context.job.sourceUrl ?? 'No visible'}`,
    '',
    'Matching:',
    `- Score: ${context.match.score ?? 'No visible'}`,
    `- Recomendacion: ${context.match.recommendation ?? 'No visible'}`,
    `- Tecnologias coincidentes: ${joinValues(context.match.matchedTechnologies)}`,
    '',
    `Plantilla sugerida: ${context.templateVariant}`,
    '',
    'Instrucciones de tono:',
    '- Usa parrafos cortos.',
    '- Evita frases grandilocuentes o genericas.',
    '- Si la empresa no es visible, no la inventes ni la menciones como desconocida.',
    '- Si el titulo no es visible, usa una formulacion general y natural.',
    '- No uses las frases prohibidas del sistema.',
    `- Frases prohibidas: ${joinValues(context.constraints.bannedPhrases)}`,
  ];

  return lines.join('\\n');
}

function joinValues(values = [], separator = ', ') {
  const normalized = values.filter(Boolean);
  return normalized.length ? normalized.join(separator) : 'Ninguno';
}
