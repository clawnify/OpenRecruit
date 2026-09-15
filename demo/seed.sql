-- Fictional hiring pipeline for the disposable template preview.
INSERT INTO settings (id, company_name, company_url, tagline, intro_md) VALUES
 ('1', 'Northlight Studio', 'https://example.test', 'Design and operations for small businesses', 'Explore a fictional hiring pipeline with sample candidates.');
INSERT INTO jobs (id, slug, title, department, status, description_md, hiring_manager) VALUES
 ('a42c447c-e8b2-50c1-a7e9-6bcabb8bc699', 'product-designer', 'Product Designer', 'Design', 'published', 'Help small business teams design clear, useful products.', 'Jamie Chen'),
 ('22da5958-3267-597a-9a8b-04cc52191fa4', 'project-coordinator', 'Project Coordinator', 'Operations', 'draft', 'Coordinate project schedules and client updates.', 'Sam Taylor');
INSERT INTO job_stages (id, job_id, position, name, kind, color) VALUES
 ('f4a04577-38bf-5b09-9ceb-3862567a1338', 'a42c447c-e8b2-50c1-a7e9-6bcabb8bc699', '0', 'Applied', 'applied', '#64748b'),
 ('3c7a13a6-e1fd-55dd-9793-955ea1208707', 'a42c447c-e8b2-50c1-a7e9-6bcabb8bc699', '1', 'Interview', 'custom', '#6366f1'),
 ('655e9281-f019-565e-9d1e-6802898c63ab', 'a42c447c-e8b2-50c1-a7e9-6bcabb8bc699', '2', 'Offer', 'custom', '#f59e0b'),
 ('b0f8916d-d634-5b48-819f-7559691373ed', 'a42c447c-e8b2-50c1-a7e9-6bcabb8bc699', '3', 'Hired', 'hired', '#10b981'),
 ('25a8b0e9-948b-576e-974c-5c48fe36cc96', '22da5958-3267-597a-9a8b-04cc52191fa4', '0', 'Applied', 'applied', '#64748b'),
 ('6c9e7709-2ce5-5470-9396-45bdbfed7e9b', '22da5958-3267-597a-9a8b-04cc52191fa4', '1', 'Interview', 'custom', '#6366f1'),
 ('59787aa4-6d83-520e-b0a2-d7636daa1825', '22da5958-3267-597a-9a8b-04cc52191fa4', '2', 'Offer', 'custom', '#f59e0b'),
 ('8f0f77d0-40ab-5c40-93f7-b9b86241d20b', '22da5958-3267-597a-9a8b-04cc52191fa4', '3', 'Hired', 'hired', '#10b981');
INSERT INTO candidates (id, name, email, headline, source, source_detail) VALUES
 ('87ab92a4-8947-5f03-9c56-c3d68321a689', 'Alex Morgan', 'alex@example.test', 'Product designer', 'referral', 'Fictional demo candidate'),
 ('7dcc18ba-684e-579a-b3bf-de936941f95a', 'Riley Chen', 'riley@example.test', 'UX designer', 'career_site', 'Fictional demo candidate'),
 ('a2f3607c-dac1-5452-879d-8e9a22f83b4e', 'Casey Rivera', 'casey@example.test', 'Project coordinator', 'sourced', 'Fictional demo candidate');
INSERT INTO applications (id, job_id, candidate_id, stage_id, source) VALUES
 ('355efc2d-1970-5adf-a7d6-a8459b2afd8f', 'a42c447c-e8b2-50c1-a7e9-6bcabb8bc699', '87ab92a4-8947-5f03-9c56-c3d68321a689', '3c7a13a6-e1fd-55dd-9793-955ea1208707', 'referral'),
 ('134b99dc-83e3-59e2-9050-7100b2bcdd3a', 'a42c447c-e8b2-50c1-a7e9-6bcabb8bc699', '7dcc18ba-684e-579a-b3bf-de936941f95a', 'f4a04577-38bf-5b09-9ceb-3862567a1338', 'career_site'),
 ('5f95a092-c4f8-5e3c-a531-3fdbfb4ae2cf', '22da5958-3267-597a-9a8b-04cc52191fa4', 'a2f3607c-dac1-5452-879d-8e9a22f83b4e', '25a8b0e9-948b-576e-974c-5c48fe36cc96', 'sourced');
INSERT INTO notes (id, application_id, candidate_id, author_name, body) VALUES
 ('3e26237c-7274-5bd3-b331-1ff25ca6e4ac', '355efc2d-1970-5adf-a7d6-a8459b2afd8f', '87ab92a4-8947-5f03-9c56-c3d68321a689', 'Jamie Chen', 'Ask about their approach to client feedback during the interview.');
