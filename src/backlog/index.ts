// Backlog Management Module - TrafficControl
// Monitors backlog depth and generates task proposals

export { BacklogManager } from './backlog-manager.js';
export type { BacklogStats, BacklogManagerOptions } from './backlog-manager.js';

export { ProposalGenerator } from './proposal-generator.js';
export type { GeneratedProposal } from './proposal-generator.js';

export { BacklogMarkdownGenerator } from './markdown-generator.js';
export type { MarkdownGeneratorOptions } from './markdown-generator.js';

export { BacklogMarkdownImporter } from './markdown-importer.js';
export type { ImportResult, MarkdownImporterOptions } from './markdown-importer.js';

export { BacklogValidator } from './validator.js';
export type { ValidationIssue, ValidationResult, ValidatorOptions } from './validator.js';
