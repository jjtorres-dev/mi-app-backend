-- Las coordenadas y su instante son opcionales para los reportes existentes.
-- location_captured_at se almacena en UTC (DATETIME sin zona horaria).
ALTER TABLE reportes
    ADD COLUMN latitude DECIMAL(10,7) NULL,
    ADD COLUMN longitude DECIMAL(10,7) NULL,
    ADD COLUMN accuracy FLOAT NULL,
    ADD COLUMN location_captured_at DATETIME(3) NULL;
