import { randomUUID } from 'node:crypto';
import { HttpError } from '../../lib/httpError.js';
import { createResumeStorageService } from './resumeStorageService.js';

export function createResumeService(repository, auditService, options = {}) {
  const resumeStorageService =
    options.resumeStorageService ?? createResumeStorageService(options);

  return {
    async listResumes() {
      const resumes = await repository.listResumes();
      return resumes.map(presentResume);
    },

    async uploadResume(input) {
      const profile = await repository.getCandidateProfile();
      const storedFile = await resumeStorageService.storeUpload(input);
      const timestamp = new Date().toISOString();

      const record = {
        id: randomUUID(),
        candidateProfileId: profile.id,
        label: input.label.trim(),
        filePath: storedFile.relativePath,
        metadata: {
          originalFileName: storedFile.originalFileName,
          storedFileName: storedFile.storedFileName,
          mimeType: storedFile.mimeType,
          extension: storedFile.extension,
          sizeBytes: storedFile.sizeBytes,
          checksumSha256: storedFile.checksumSha256,
          uploadedAt: storedFile.uploadedAt,
          attachmentStatus: 'MANUAL_REQUIRED',
          source: 'local_upload',
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      const saved = await repository.saveResume(record);

      await auditService.record('resume.uploaded', 'resume', saved.id, {
        label: saved.label,
        originalFileName: saved.metadata.originalFileName,
        sizeBytes: saved.metadata.sizeBytes,
      });

      return presentResume(saved);
    },

    async assignResumeToJob(jobId, resumeId) {
      const jobAnalysis = await repository.getJobAnalysisById(jobId);
      if (!jobAnalysis) {
        throw new HttpError(404, 'Job analysis not found');
      }

      let selection = null;
      if (resumeId) {
        const resume = await repository.getResumeById(resumeId);
        if (!resume) {
          throw new HttpError(404, 'Resume not found');
        }

        selection = createResumeSelection(resume);
      }

      const updatedAnalysis = {
        ...jobAnalysis,
        resumeSelection: selection,
      };

      await repository.updateJobAnalysis(updatedAnalysis);
      await auditService.record(
        selection ? 'job_offer.resume_selected' : 'job_offer.resume_cleared',
        'job_offer',
        jobId,
        {
          resumeId: selection?.id ?? null,
          label: selection?.label ?? null,
        },
      );

      return {
        jobId,
        selectedResume: selection,
      };
    },
  };
}

function presentResume(record) {
  return {
    id: record.id,
    label: record.label,
    originalFileName: record.metadata.originalFileName,
    mimeType: record.metadata.mimeType,
    extension: record.metadata.extension,
    sizeBytes: record.metadata.sizeBytes,
    checksumSha256: record.metadata.checksumSha256,
    uploadedAt: record.metadata.uploadedAt ?? record.createdAt,
    attachmentStatus: record.metadata.attachmentStatus ?? 'MANUAL_REQUIRED',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function createResumeSelection(resume) {
  return {
    id: resume.id,
    label: resume.label,
    originalFileName: resume.metadata.originalFileName,
    mimeType: resume.metadata.mimeType,
    extension: resume.metadata.extension,
    sizeBytes: resume.metadata.sizeBytes,
    uploadedAt: resume.metadata.uploadedAt ?? resume.createdAt,
    checksumSha256: resume.metadata.checksumSha256,
    attachmentStatus: resume.metadata.attachmentStatus ?? 'MANUAL_REQUIRED',
    selectedAt: new Date().toISOString(),
  };
}
