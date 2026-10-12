
try {
 const { createApiReference } = await import('/docs/vendor/standalone.esm.js');
 const response = await fetch('/openapi.json');
 if (!response.ok) throw new Error('OpenAPI unavailable');
 const schema = await response.json();
 // Scalar treats unknown HTTP schemes as Basic. Describe the same DPoP header explicitly.
 if (schema.components?.securitySchemes?.DPoP) schema.components.securitySchemes.DPoP = {type:'apiKey',in:'header',name:'Authorization',description:'Use DPoP <session_token> here, with a fresh signed DPoP proof in the separate DPoP header. See the agent guide.'};
 createApiReference('#api-reference', {content:schema,agent:{disabled:true},mcp:{disabled:true},operationTitleSource:'path',customCss:'.light-mode { --scalar-color-1:#2c2119; --scalar-color-2:#756657; --scalar-color-3:#887a6b; --scalar-color-accent:#c44c0a; --scalar-background-1:#fcf8f0; --scalar-background-2:#f5eee4; --scalar-background-3:#eee4d6; --scalar-border-color:#e4d9cb; }',theme:'none',layout:'modern',forceDarkModeState:'light',hideDarkModeToggle:true,hideClientButton:true,hideTestRequestButton:true,showDeveloperTools:'never',telemetry:false,withDefaultFonts:false,persistAuth:false,defaultHttpClient:{targetKey:'shell',clientKey:'curl'}});
} catch {
 document.getElementById('api-reference').innerHTML='<p class="loading">The interactive reference could not load. <a href="/openapi.json">Read the OpenAPI JSON</a> or <a href="/for-agents">open the agent guide</a>.</p>';
}
