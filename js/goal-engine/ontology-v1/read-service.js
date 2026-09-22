import { assertNoStrategySmuggling } from './contracts.js';
import { validateCompanyStateManifest } from './company-state.js';
import { createOntologyReadPacket, ONTOLOGY_READ_LIMITS } from './read-packet.js';

function exactRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)
      || Object.keys(request).sort().join(',') !== 'companyStateVersionId,ventureId'
      || typeof request.ventureId !== 'string' || !request.ventureId
      || !/^csv:v1:[0-9a-f]{64}$/.test(request.companyStateVersionId)) {
    throw new TypeError('Ontology read request must contain only ventureId and companyStateVersionId');
  }
  assertNoStrategySmuggling(request, 'OntologyReadRequestV1');
}

function preserveFrozenStatus(component) {
  return Object.freeze({
    ...component,
    sourceResolutionStatus: component.readStatus,
    resolutionReasonCode: component.reasonCode,
  });
}

export function createOntologyReadService({ transport }) {
  if (!transport || !['loadManifest', 'verifyComponent', 'readBoundedViews'].every((key) => typeof transport[key] === 'function')) {
    throw new TypeError('Ontology read service requires the bounded read transport');
  }
  return Object.freeze({
    async read(request) {
      exactRequest(request);
      let loaded;
      try { loaded = await transport.loadManifest(request); }
      catch { return Object.freeze({ status: 'READ_FAILED', reasonCode: 'MANIFEST_READ_FAILED' }); }
      if (!loaded || loaded.status !== 'PRESENT') {
        return Object.freeze({ status: loaded?.status === 'NOT_FOUND' ? 'NOT_FOUND' : 'UNAVAILABLE', reasonCode: loaded?.reasonCode ?? 'MANIFEST_UNAVAILABLE' });
      }
      let manifest;
      try {
        manifest = validateCompanyStateManifest(loaded.companyStateVersion);
        if (manifest.ventureId !== request.ventureId || manifest.companyStateVersionId !== request.companyStateVersionId) throw new TypeError('manifest request mismatch');
      } catch {
        return Object.freeze({ status: 'READ_FAILED', reasonCode: 'MANIFEST_VALIDATION_FAILED' });
      }

      const components = [];
      for (const component of manifest.components) {
        if (component.readStatus !== 'PRESENT') {
          components.push(preserveFrozenStatus(component));
          continue;
        }
        let resolution;
        try {
          resolution = await transport.verifyComponent({
            ventureId: request.ventureId,
            companyStateVersionId: request.companyStateVersionId,
            componentType: component.componentType,
          });
        } catch {
          resolution = { sourceResolutionStatus: 'READ_FAILED', reasonCode: 'OWNER_READ_FAILED' };
        }
        components.push(Object.freeze({
          ...component,
          sourceResolutionStatus: resolution?.sourceResolutionStatus ?? 'READ_FAILED',
          resolutionReasonCode: Object.hasOwn(resolution ?? {}, 'reasonCode') ? resolution.reasonCode : 'OWNER_READ_FAILED',
        }));
      }

      let views;
      try {
        views = await transport.readBoundedViews({ ...request, ...ONTOLOGY_READ_LIMITS });
      } catch {
        views = { status: 'READ_FAILED', reasonCode: 'BOUNDED_VIEWS_READ_FAILED' };
      }
      try {
        return Object.freeze({ status: 'PRESENT', packet: createOntologyReadPacket({ manifest, components, views }) });
      } catch {
        return Object.freeze({ status: 'READ_FAILED', reasonCode: 'READ_PACKET_VALIDATION_FAILED' });
      }
    },
  });
}

export function createSupabaseOntologyReadTransport(client) {
  if (!client || typeof client.rpc !== 'function') throw new TypeError('Supabase RPC client is required');
  const call = async (name, args) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  };
  return Object.freeze({
    loadManifest: ({ ventureId, companyStateVersionId }) => call('get_company_state_version_v1', {
      p_venture_id: ventureId, p_company_state_version_id: companyStateVersionId,
    }),
    verifyComponent: ({ ventureId, companyStateVersionId, componentType }) => call('ontology_verify_company_state_component_v1', {
      p_venture_id: ventureId, p_company_state_version_id: companyStateVersionId, p_component_type: componentType,
    }),
    readBoundedViews: ({ ventureId, companyStateVersionId, maxEntities, maxClaims, maxEvidenceRefs, maxRelationships }) => call('ontology_read_phase4_views_v1', {
      p_venture_id: ventureId, p_company_state_version_id: companyStateVersionId,
      p_entity_limit: maxEntities, p_claim_limit: maxClaims,
      p_evidence_limit: maxEvidenceRefs, p_relationship_limit: maxRelationships,
    }),
  });
}
