import type { ExporterDescriptor, ExportFormat, ExportTypeKind } from '../shared/messages/export';
import { createHtmlEncoder, HTML_DESCRIPTOR } from './encoders/html';
import { createJsonEncoder, JSON_DESCRIPTOR } from './encoders/json';
import type { TextExportEncoder } from './types';

/**
 * The exporter registry: each exporter publishes a capability descriptor (sent to the webview at
 * init) and a factory for its streaming encoder. Adding a format means adding one entry here.
 *
 * Only JSON and HTML are implemented for now; the other formats in {@link ExportFormat} have plans in
 * local/features/exports but no encoder yet, so they are intentionally absent (the webview only
 * offers formats present here).
 */
export interface ExporterRegistration {
	descriptor: ExporterDescriptor;
	createEncoder: () => TextExportEncoder;
}

const REGISTRY: Partial<Record<ExportFormat, ExporterRegistration>> = {
	json: { descriptor: JSON_DESCRIPTOR, createEncoder: createJsonEncoder },
	html: { descriptor: HTML_DESCRIPTOR, createEncoder: createHtmlEncoder }
};

/** All registered exporter descriptors, for the `exportCapabilities` message. */
export function getExporterDescriptors(): ExporterDescriptor[] {
	return Object.values(REGISTRY).map(registration => registration.descriptor);
}

export function getExporter(format: ExportFormat): ExporterRegistration | undefined {
	return REGISTRY[format];
}

/** The semantic kind of an exporter's type id, or 'text' when the id is unknown. */
export function kindOfType(format: ExportFormat, typeId: string): ExportTypeKind {
	return REGISTRY[format]?.descriptor.types.find(type => type.id === typeId)?.kind ?? 'text';
}
