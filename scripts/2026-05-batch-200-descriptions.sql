-- =============================================================================
-- 2026-05-batch-200-descriptions.sql
-- =============================================================================
-- Backfill de `description` (ES) para los 200 coches insertados en el batch
-- anterior (2026-05-batch-200-cars.sql). Tono Polestar 1: técnico-emocional,
-- 1-2 frases, datos concretos donde aporten, sin "carta de presentación de
-- la marca" como muletilla — variado en estructura y vocabulario.
--
-- Idempotente: solo actualiza filas con description IS NULL. Si re-corres
-- esto tras añadir manualmente alguna descripción, esa no se pisa.
--
-- Después de ejecutar este script, llena las descripciones EN corriendo:
--   node scripts/translate-existing-descriptions.js
-- que ya existe y usa DeepL para traducir lo que tenga description != NULL
-- y description_en = NULL.
--
-- Match por (make, model, year): si por algún motivo el insert previo no
-- coincide exactamente con alguno de estos triples, esa fila se queda
-- sin description y no rompe nada — corre el SELECT al final para ver
-- cuántas quedaron sin emparejar.
-- =============================================================================

UPDATE public.cars AS c
SET description = v.descr
FROM (VALUES
  -- Alemania (45)
  ('Audi', 'A8 W12', 2005, 'Berlina insignia con W12 atmosférico de 6.0 litros y 450 CV. Devora autovías sin levantar sospechas: dos V8 fundidos en bloque común y nadie se entera por fuera.'),
  ('Audi', 'RS3 Sportback', 2017, 'Compacta con el inconfundible cinco cilindros 2.5 TFSI: 400 CV, sonido grave y tracción quattro. La fórmula que devolvió a Ingolstadt al territorio del Golf R.'),
  ('Audi', 'TT Mk1', 1998, 'El que se atrevió a hacer un cupé Bauhaus para producción en masa. Diseño tan limpio que envejeció bien y mecánica Volkswagen 1.8 turbo bajo la piel.'),
  ('Audi', 'S2 Coupe', 1991, 'Predecesor de la era RS. Cinco cilindros turbo de 220 CV, tracción quattro y carrocería derivada del coupé original. La receta germana antes de que todos la copiaran.'),
  ('Audi', 'V8 Quattro', 1988, 'Primer V8 firmado por Audi. Berlina de lujo deportivo con tracción total quattro de serie cuando casi nadie en el segmento la ofrecía. Cinco generaciones de A8 después, todo viene de aquí.'),
  ('Audi', 'A2', 2000, 'Compacto con carrocería de aluminio y versión 1.2 TDI 3L que apenas pasaba de los 3 litros cada 100 km. Fracaso de ventas, manifiesto de ingeniería.'),
  ('Audi', '80', 1986, 'Berlina familiar B3, austera por fuera y muy bien resuelta por dentro. Base mecánica de medio catálogo del grupo durante una década.'),
  ('BMW', 'M3 E46', 2000, 'Considerado por muchos el mejor M3 jamás hecho. Seis en línea S54 atmosférico de 3.2 litros, 343 CV, caja manual y propulsión trasera. Sin ayudas, sin excusas.'),
  ('BMW', 'M5 E60', 2005, 'El de los 507 CV con V10 atmosférico y cambio SMG. Sedán comportándose como GT del Nürburgring. Caja problemática, sonido inolvidable.'),
  ('BMW', 'M2', 2016, 'Coupé compacto con seis en línea 3.0 biturbo y propulsión trasera. La interpretación moderna del 2002: manual disponible, casi sin filtros entre conductor y asfalto.'),
  ('BMW', '3.0 CSL', 1972, 'Conocido como Batmobile por su alerón delirante. Homologación para el ETCC: aluminio en puertas y capó, vidrio finísimo en las lunas, kilo a kilo arrancado para correr.'),
  ('BMW', 'i3', 2013, 'Compacto eléctrico con monocasco de fibra de carbono. Diseño polarizante, ingeniería radical: el i3 fue lo que se atrevió a hacer BMW cuando los demás aún hacían PowerPoints sobre el coche del futuro.'),
  ('BMW', 'Z3 M', 1997, 'Roadster con la mecánica del M3 E36 metida a calzador. James Bond se pidió uno en GoldenEye y aquí terminó siendo objeto de deseo para una generación entera.'),
  ('BMW', '2002 Tii', 1971, 'Origen del ADN deportivo de Múnich. Sedan compacto con dos litros inyectados, 130 CV y un equilibrio mecánico que sentó cátedra. Sin él no hay M3.'),
  ('BMW', 'M1', 1978, 'Único superdeportivo de serie firmado por la división M. Motor central seis en línea, carrocería Giugiaro y producción italiana torpe. Pieza única, irrepetible.'),
  ('BMW', '850 CSi', 1992, 'Cupé gran turismo con V12 de 5.6 litros y 380 CV. El intento más serio de BMW por competir con los grandes Mercedes y Jaguar de su época. Espectacular y deficitario.'),
  ('Mercedes-Benz', '190E 2.3-16', 1984, 'Compacto Cosworth: 16 válvulas, 185 CV y carrocería kit aero. Base del DTM más bestia de los ochenta. Senna lo usó para ganar la carrera inaugural de Nürburgring.'),
  ('Mercedes-Benz', 'E55 AMG', 1997, 'Berlina sleeper con V8 5.4 AMG y 354 CV. Por fuera, un W210 más; por dentro, un misil de autovía. La primera definición de lo que sería AMG masivo.'),
  ('Mercedes-Benz', 'CLK GTR', 1997, 'Homologación para FIA GT. Carrocería de carbono, V12 6.0 atmosférico de 612 CV y 25 unidades de calle. El precio de adquisición pagaba sí o sí.'),
  ('Mercedes-Benz', 'AMG GT', 2014, 'Sucesor del SLS. V8 4.0 biturbo, transmisión transeje y perfil clásico de GT alemán. Más manejable que su antecesor, igual de teatral.'),
  ('Mercedes-Benz', '600 Pullman', 1963, 'Limusina presidencial con V8 6.3 atmosférico e hidráulica para todo. La llevaron jefes de estado, dictadores y John Lennon. Cualquiera con dinero, vamos.'),
  ('Mercedes-Benz', 'W124', 1984, 'Berlina ejecutiva indestructible. Calidad de construcción de las que ya no se hacen: taxi en Berlín, plataforma de blindajes en Bogotá, sigue funcionando.'),
  ('Mercedes-Benz', 'AMG ONE', 2022, 'Fórmula 1 con matrícula. V6 híbrido de 1.6 litros directamente derivado del W10 de Hamilton, 1063 CV y revoluciones hasta 11.000. Más complejo que práctico.'),
  ('Mercedes-Benz', 'C63 AMG', 2008, 'Sedán con V8 6.2 atmosférico de 451 CV. La última generación AMG antes del downsizing turbo: sonido que ya no existe en el catálogo actual de la marca.'),
  ('Mercedes-Benz', '280 SL Pagoda', 1963, 'Roadster con techo rígido cóncavo, de ahí el apodo. Seis en línea de 2.8 litros, líneas de Paul Bracq y construcción imposible de discutir.'),
  ('Porsche', '944 Turbo', 1985, 'Front-engine 2.5 turbo equilibrado al milímetro: motor delante, transmisión transeje detrás. Reparte pesos como pocos coches del segmento. Infravalorado durante años.'),
  ('Porsche', '968', 1991, 'Última iteración de la saga 924/944. Cuatro cilindros 3.0 atmosférico, 240 CV y caja manual de seis. El canto del cisne del Porsche con motor delantero.'),
  ('Porsche', 'Boxster', 1996, 'Roadster mid-engine que salvó a la marca de la quiebra a mediados de los noventa. Flat-six bóxer y precio accesible: el Porsche que abrió la puerta a una generación entera.'),
  ('Porsche', 'Cayman GT4', 2015, 'Cupé central con motor del 911 GT3. Manual de seis, suspensión derivada de competición y una calibración que muchos prefieren al propio 911 en el día a día.'),
  ('Porsche', 'Macan Turbo', 2014, 'SUV deportivo derivado del Q5. V6 biturbo de 400 CV, alma de Cayenne y dinámica que sorprende para dos toneladas. El Macan terminó pagando los próximos diez años de I+D de Porsche.'),
  ('Porsche', '928 GTS', 1991, 'Iteración final del 928. V8 5.4 atmosférico de 350 CV, transeje trasero y línea Lagaay. Pensado para reemplazar al 911. El 911 le aguantó.'),
  ('Porsche', '911 GT3 RS', 2018, '991.2 con flat-six 4.0 atmosférico de 520 CV y 9.000 rpm. Aerodinámica activa, gomas semi-slick y un set-up nacido para el cronómetro.'),
  ('Porsche', 'Panamera Turbo', 2009, 'Primer Panamera. Polémico en su lanzamiento por la silueta, vindicado por la dinámica. V8 4.8 biturbo y todas las dudas sobre si Porsche podía hacer berlinas, resueltas.'),
  ('Volkswagen', 'Corrado VR6', 1991, 'Cupé compacto con VR6 2.8 de geometría única: seis cilindros en bloque estrecho. 190 CV, alerón móvil y la sensación constante de que Wolfsburg apuntó más alto de lo necesario.'),
  ('Volkswagen', 'Golf R32', 2002, 'Mk4 con VR6 3.2 atmosférico y tracción 4Motion. 241 CV, sonido grave inconfundible y la introducción de la caja DSG de doble embrague en un Golf.'),
  ('Volkswagen', 'Touareg V10 TDI', 2002, 'SUV con V10 diésel biturbo de 5.0 litros, 313 CV y 750 Nm. El que arrastró el Boeing 747 en el anuncio. Sobrante de tecnología en cada milímetro.'),
  ('Volkswagen', 'Phaeton W12', 2002, 'Berlina capricho de Ferdinand Piëch. Quería un sedán capaz de viajar a 300 km/h con 50°C exteriores manteniendo 22°C en cabina. Lo consiguió, y el mercado lo ignoró.'),
  ('Volkswagen', 'Polo GTI', 2018, 'Pequeño hot hatch con 2.0 TSI de 200 CV. La fórmula GTI llevada al chasis más compacto del catálogo VW: punzante en ciudad, sorprendente en carretera abierta.'),
  ('Volkswagen', 'Lupo GTI', 2000, 'Microdeportivo con 1.6 16V de 125 CV y 980 kg. La interpretación moderna del Mini Cooper original: ligero, vivo y sin filtros.'),
  ('Volkswagen', 'Karmann Ghia', 1955, 'Cupé con plataforma de Beetle y carrocería italiana Ghia. Mecánica humilde, líneas que envejecieron como pocas. Comprado entonces por su belleza, valorado hoy igual.'),
  ('Opel', 'Astra OPC', 2005, 'Hot hatch con 2.0 turbo de 240 CV y suspensión recalibrada. La respuesta de Rüsselsheim al Golf GTI Mk5, con un punto más agresivo en el set-up.'),
  ('Opel', 'Manta GT/E', 1977, 'Cupé deportivo de propulsión trasera con motor 2.0 inyectado. Coche de tunear por excelencia en la Alemania de los ochenta, y por eso quedan tan pocos originales.'),
  ('Opel', 'Speedster', 2000, 'Roadster ligero construido sobre la base del Lotus Elise: chasis aluminio y todo. Motor 2.2 central de Opel, 220 kg menos que el primer Boxster y la mitad de su precio.'),
  ('Opel', 'Corsa OPC', 2007, 'Hot hatch pequeño con 1.6 turbo de 192 CV. Suspensión Nürburgring opcional, frenos Brembo y una relación peso-potencia que se las apañaba con cualquier rival de su segmento.'),
  ('Smart', 'Roadster Brabus', 2003, 'Microdeportivo con motor turbo trasero de 698 cc y 101 CV en la versión Brabus. Conducir uno es la cosa más parecida a un go-kart con matrícula que ha llegado a producirse.'),

  -- Italia (30)
  ('Ferrari', '458 Italia', 2009, 'Sucesor del F430. V8 4.5 atmosférico de 570 CV revolucionando hasta 9.000 rpm. Para muchos el último Ferrari de motor central sin turbo, y por eso ya cotiza al alza.'),
  ('Ferrari', '360 Modena', 1999, 'Primer Ferrari mid-engine en chasis íntegramente de aluminio. V8 3.6 atmosférico de 400 CV y diseño Pininfarina que dejó atrás los frontales rectangulares para siempre.'),
  ('Ferrari', 'F50', 1995, 'V12 atmosférico de 4.7 litros derivado del 641 de Fórmula 1. 349 unidades para celebrar el 50 aniversario. Sin asistencias electrónicas: solo conductor y respuesta directa del motor.'),
  ('Ferrari', '288 GTO', 1984, 'Homologación Grupo B que nunca corrió porque la categoría se canceló. V8 2.8 biturbo, 400 CV y 272 unidades. Padre de la dinastía F40.'),
  ('Ferrari', '308 GTB', 1975, 'El de Magnum P.I. V8 3.0 central, líneas Pininfarina y la silueta que muchos visualizan al pensar Ferrari de los setenta.'),
  ('Ferrari', 'Daytona', 1968, 'Apodo nacido de la victoria en las 24 Horas de Daytona del 67. El nombre oficial era 365 GTB/4: V12 atmosférico de 4.4 litros y motor delantero, último gran cupé front-engine antes del cambio de era.'),
  ('Ferrari', 'Dino 246 GT', 1969, 'V6 central de 2.4 litros, marca Dino en lugar de Ferrari como homenaje al hijo fallecido de Enzo. Pininfarina dibujando en estado de gracia.'),
  ('Lamborghini', 'Aventador', 2011, 'V12 6.5 atmosférico, puertas tijera y silueta directa de los pósters de la generación que creció con ellos. Sucesor del Murciélago, último V12 atmosférico no electrificado de Sant''Agata.'),
  ('Lamborghini', 'Huracán', 2014, 'V10 5.2 atmosférico, tracción AWD y diseño que envejece tarde. Sucesor del Gallardo en un proceso de refinamiento más que de revolución.'),
  ('Lamborghini', 'Gallardo', 2003, 'Primer Lambo bajo gestión Audi. V10 5.0 atmosférico, 500 CV y la pieza con la que Sant''Agata aprendió por fin a vender en volumen: más de 14.000 unidades.'),
  ('Lamborghini', 'Murciélago', 2001, 'V12 6.2 atmosférico, luego 6.5 en LP640. Diseño Luc Donckerwolke, sucesor del Diablo y primer Lambo construido como Dios manda con ingeniería alemana detrás.'),
  ('Lamborghini', 'Urus', 2018, 'SUV con V8 4.0 biturbo de 650 CV. El que paga las facturas de los V12 y los V10 atmosféricos del resto del catálogo. Por eso vale lo que vale.'),
  ('Lamborghini', 'Espada', 1968, 'GT de cuatro plazas reales con V12 atmosférico delantero. Líneas Bertone afiladísimas, asientos traseros que de verdad caben. Único en su concepto en el catálogo de Sant''Agata.'),
  ('Lamborghini', 'LM002', 1986, '4x4 brutal con V12 del Countach. Bautismo militar abortado, terminó siendo capricho de jeques. Apodado Rambo Lambo y muy capaz de hacer honor al nombre.'),
  ('Alfa Romeo', '33 Stradale', 1967, '18 unidades. V8 atmosférico 2.0 derivado del Tipo 33 de competición. Líneas Franco Scaglione: el listado de candidatos al cupé más hermoso de la historia empieza casi siempre por aquí.'),
  ('Alfa Romeo', 'Giulia Quadrifoglio', 2015, 'Berlina con V6 2.9 biturbo derivado de Ferrari y 510 CV. Tracción trasera, 0-100 en 3.9 segundos y un comportamiento que devolvió a la marca al mapa premium.'),
  ('Alfa Romeo', 'Spider Duetto', 1966, 'Roadster Pininfarina con cuatro cilindros bialbero. El que conducía Dustin Hoffman en El Graduado: generaciones enteras se enamoraron de Alfa Romeo por culpa de esa película.'),
  ('Alfa Romeo', 'SZ', 1989, 'Sprint Zagato apodado Il Mostro por sus propios diseñadores. V6 3.0 Busso, 210 CV, 1.000 unidades y un frontal que solo gusta o solo disgusta: punto medio no hay.'),
  ('Alfa Romeo', '156 GTA', 2001, 'Berlina (y familiar) con V6 3.2 Busso de 250 CV. Tracción delantera, sonido inconfundible y un set-up que devolvió cierta credibilidad deportiva a la marca tras años de tibieza.'),
  ('Lancia', 'Fulvia', 1963, 'Cupé compacto con V4 estrechísimo, bancada cerrada a 13°. Ganadora del Mundial de Rally de 1972 en versión HF. Coche pequeño, palmarés grande.'),
  ('Lancia', 'Beta Montecarlo', 1975, 'Cupé mid-engine de Pininfarina. Motor 2.0 transversal central. Base de los Lancia 037 y LC2 que vinieron después: embrión de la edad dorada de Lancia en competición.'),
  ('Fiat', 'Barchetta', 1995, 'Roadster sobre plataforma Punto, 1.8 16V de 130 CV y diseño Andreas Zapatinas. Asequible, divertido y muy italiano: virtudes claras, defectos esperables.'),
  ('Fiat', '124 Spider', 1966, 'Roadster Pininfarina, mecánica robusta y carácter mediterráneo. Producido durante 20 años, terminando fabricado en Pininfarina con el simple apellido Spider.'),
  ('Fiat', 'X1/9', 1972, 'Mid-engine con techo targa desmontable, diseño Bertone afilado y mecánica del 128. La idea de un Ferrari pequeño funcionando para todo el mundo. Casi lo consiguen.'),
  ('Maserati', 'Bora', 1971, 'Primer mid-engine de Maserati. V8 4.7 italiano y suspensión hidroneumática herencia de la breve etapa Citroën al mando. Refinado, raro, distinto.'),
  ('Maserati', 'MC20', 2020, 'Regreso de Maserati al territorio supercar. V6 3.0 biturbo Nettuno desarrollado en casa, chasis monocasco de carbono y diseño limpio en una era de aerodinámicas barrocas.'),
  ('Maserati', 'Ghibli', 2013, 'Berlina deportiva con motores V6 biturbo (y V8 en la versión más potente) cortesía de Ferrari. La apuesta de Maserati por hacer volumen: recibió críticas, sostuvo cuentas.'),
  ('De Tomaso', 'Mangusta', 1967, 'Coupé mid-engine con V8 Ford y chasis del prototipo de carreras Cooper que nunca corrió. Líneas Giugiaro, manejo mediocre: comprado por la silueta más que por la cronos.'),
  ('Iso', 'Grifo', 1965, 'GT italiano con V8 small-block Chevrolet. La idea: fiabilidad americana en chasis italiano firmado por Bertone. Costó la mitad que un Ferrari y corría más.'),
  ('Abarth', '595', 2008, 'Fiat 500 con tratamiento Scorpio. 1.4 T-jet hasta 180 CV en la versión más bestia, escape Record Monza y la conducta exacta de un perro pequeño con ego enorme.'),

  -- Japón (35)
  ('Toyota', 'Supra Mk4', 1993, '2JZ-GTE de 3.0 litros biturbo. Bloque sobreingeniado capaz de aguantar el doble de potencia de serie sin chistar: por eso es el rey del tuning. Fast and Furious solo amplificó la leyenda.'),
  ('Toyota', 'GR Supra', 2019, 'Resurrección coproducida con BMW. Seis en línea B58 turbo, propulsión trasera y silueta corta. Polémica entre puristas por la colaboración, vindicada por el comportamiento.'),
  ('Toyota', 'Celica GT', 1970, 'Primera generación. Cupé compacto de propulsión trasera, posicionado como respuesta japonesa al Mustang. Honesto, asequible, divertido: la fórmula que cimentó la imagen deportiva de Toyota.'),
  ('Toyota', '2000GT', 1967, 'Primer superdeportivo japonés. Colaboración Yamaha para el seis en línea de 2.0 litros, carrocería de magnesio y producción artesanal: 351 unidades. Apareció en Sólo se vive dos veces.'),
  ('Toyota', 'Hilux', 1968, 'Pickup indestructible. Top Gear lo prendió fuego, lo sumergió en el mar, lo dejó arriba de un edificio dinamitado y siguió arrancando. Leyenda construida en programa de televisión, sostenida por décadas en mercados imposibles.'),
  ('Toyota', 'GT86', 2012, 'Coupé compacto con plano cuatro Subaru de 2.0 atmosférico y propulsión trasera. Diseñado para deslizar: neumáticos del Prius incluidos en la receta a propósito.'),
  ('Toyota', 'Corolla AE86', 1983, 'Hachiroku. Cupé compacto con propulsión trasera, motor 1.6 atmosférico y eje rígido. Convertido en culto por el manga Initial D. La base es un Toyota familiar barato y eso es parte del encanto.'),
  ('Honda', 'Civic Type R EK9', 1997, 'JDM puro. B16B de 1.6 litros atmosférico, 185 CV y un VTEC con apertura quirúrgica. Tracción delantera, sin asistencias, sin grasa de fábrica: pasada por torno antes de ensamblar.'),
  ('Honda', 'Civic Type R FK8', 2017, '2.0 turbo de 320 CV, tracción delantera y récord de Nürburgring para FWD cuando salió. Estética que solo gusta o solo no, comportamiento que callaba bocas en cualquier circuito.'),
  ('Honda', 'Integra Type R DC2', 1995, 'Cupé compacto con B18C de 1.8 litros atmosférico y 200 CV. Los puristas lo señalan como el mejor FWD jamás hecho. Argumentar lo contrario requiere agallas.'),
  ('Honda', 'Prelude', 1978, 'Cupé compacto, primer Honda con techo solar eléctrico de serie. La quinta generación llegó a montar 4WS (dirección a las cuatro ruedas) antes que casi nadie en el mercado masivo.'),
  ('Honda', 'Insight', 1999, 'Primer híbrido vendido en Estados Unidos. Carrocería aluminio, dos plazas, coeficiente aerodinámico ridículo. Llegó al mercado antes que el Prius y nadie se acuerda.'),
  ('Nissan', 'Skyline GT-R R32', 1989, 'Godzilla. RB26DETT 2.6 biturbo, tracción ATTESA-ETS y direcciones a las cuatro ruedas. Dominó Bathurst con tal contundencia que los australianos cambiaron las normas para excluirlo.'),
  ('Nissan', 'Sunny GTI-R', 1990, 'Homologación Grupo A. Compacto con 2.0 turbo de 220 CV y tracción AWD ATTESA. Producido en cantidades mínimas. Hoy, objeto buscado en el JDM coleccionista.'),
  ('Nissan', '200SX', 1988, 'Chasis S13 con propulsión trasera y motores 1.8 turbo. Coche-puente entre el comprador joven y el escenario del drift japonés. Buena parte del catálogo S-chassis pasa por aquí.'),
  ('Nissan', 'Pulsar GTI-R', 1990, 'Hot hatch compacto con motor SR20DET de 230 CV y tracción AWD. Homologación rally Grupo A, vida competitiva corta, condición de objeto raro garantizada.'),
  ('Nissan', 'Patrol', 1980, '4x4 robusto y minimalista. Series Y60 y Y61 son culto entre safari y travesía africana, frecuentemente el último coche en pie cuando todo lo demás falla.'),
  ('Nissan', 'Fairlady Z', 1969, 'El nombre japonés del Datsun 240Z. Cupé deportivo asequible, seis en línea atmosférico, propulsión trasera y un diseño que se le robó algo al E-Type sin sentirlo.'),
  ('Mazda', '323 GTX', 1986, 'Compacto AWD con 1.6 turbo de 132 CV, homologación rally Grupo A. Convivió con Lancia Delta y Audi Quattro en pistas de tierra. Nunca llegó al peso mediático de los otros, igual de eficaz.'),
  ('Mazda', 'Cosmo', 1967, 'Primer rotativo de producción de la marca. Wankel de dos rotores, líneas espaciales y una decisión técnica sobre la que Mazda construiría 50 años de identidad.'),
  ('Mazda', '787B', 1991, 'Único rotativo Wankel en ganar las 24 Horas de Le Mans. R26B de cuatro rotores y un sonido que se pidió específicamente al equipo ingenieril como objetivo de diseño.'),
  ('Mitsubishi', 'Pajero', 1982, '4x4 con tres campeonatos consecutivos en el París-Dakar de los noventa. Estructura compuesta de chasis y carrocería, motores diésel resistentes y fama merecida en travesía.'),
  ('Mitsubishi', 'Eclipse', 1989, 'Cupé compacto sobre plataforma DSM compartida con Chrysler y Eagle. 2.0 turbo opcional, AWD opcional, posibilidades infinitas: la base de muchos primeros tunings noventeros.'),
  ('Mitsubishi', 'Lancer Evolution III', 1995, 'Mitsubishi en su mejor era de WRC. Bloque 4G63 turbo, transmisión activa AYC y peso de jugador olímpico. Carlos Sainz al volante en 1995.'),
  ('Subaru', 'Forester STi', 2003, 'SUV deportivo con EJ25 turbo de 261 CV: el corazón del Impreza WRX metido en caja alta. Limitada, rara, especialmente cotizada en mercados donde no llegó.'),
  ('Subaru', 'Legacy', 1989, 'Plataforma del primer Impreza WRX. Bóxer de cuatro AWD y récord de velocidad sostenida en circuito durante 19 días: 100.000 km a 223 km/h de media. Récord, no concepto.'),
  ('Subaru', 'Vivio', 1992, 'Kei car con versión RX-R bóxer 660 cc turbo. Ganó el Safari Rally de 1993 con Colin McRae. Subaru demostrando que cualquier coche que sale al patio se puede preparar para correr.'),
  ('Suzuki', 'Jimny', 1970, 'Microscópico 4x4 con caja reductora, chasis de escalera y peso pluma. Sube donde no entran Land Cruisers ni Wranglers. Simple cuestión de tamaño y reparto de pesos.'),
  ('Suzuki', 'Vitara', 1988, 'SUV compacto antes de que existiera la palabra crossover. Chasis de escalera, 4WD real y formato de tres puertas descapotable que ahora no fabrica nadie.'),
  ('Lexus', 'LC500', 2016, 'GT atmosférico con V8 5.0 de 477 CV en una era de downsizing. Estética por encima de la mayoría del segmento, mecánica honesta y un escape que justifica las opciones.'),
  ('Lexus', 'RC F', 2014, 'Cupé con el mismo V8 atmosférico 5.0 del LC. Más pesado que la mayoría de sus rivales alemanes y, pese a eso, mucho más satisfactorio acústicamente.'),
  ('Daihatsu', 'Charade GTti', 1987, 'Microscópico hot hatch con tres cilindros 1.0 turbo de 100 CV. Mejor relación peso-potencia de su categoría en los ochenta. Hoy es rareza absoluta.'),
  ('Datsun', '240Z', 1969, 'Cupé deportivo asequible, seis en línea de 2.4 atmosférico y propulsión trasera. Para muchos, el momento en que Japón aprendió a hacer coches que se desearan, no solo que se necesitaran.'),
  ('Infiniti', 'G37', 2007, 'Cupé y berlina con V6 3.7 atmosférico de 333 CV. Propulsión trasera o tracción total. La interpretación más asequible del esquema BMW Serie 3: ignorada en Europa, vendida bien en Estados Unidos.'),
  ('Mazda', 'RX-3', 1971, 'Cupé compacto con rotativo 12A. Construido para hacer frente al Skyline en touring, y lo hizo: 100 victorias consecutivas en las series japonesas de la categoría.'),

  -- EE.UU. (25)
  ('Ford', 'Mustang GT', 2015, 'S550 con V8 5.0 Coyote atmosférico de 435 CV. Primera generación con suspensión trasera independiente: Detroit por fin se rindió a la evidencia. Manual disponible.'),
  ('Ford', 'GT', 2005, 'Homenaje al GT40 con V8 5.4 sobrecomprimido de 550 CV. Producción limitada a 4.038 unidades para celebrar el centenario de la marca. Diseño Camilo Pardo, alma puramente americana.'),
  ('Ford', 'Thunderbird', 1955, 'Primera generación. Personal luxury car que estrenó la categoría en Estados Unidos. Roadster de dos plazas con V8 small-block: la respuesta de Ford al Corvette de Chevrolet.'),
  ('Ford', 'Escort RS2000', 1975, 'Mk2. 2.0 atmosférico, propulsión trasera y carrocería pegada al pavimento. Base de muchos Escort de rally. El morro Droopsnoot lo distingue de la calle a 200 metros.'),
  ('Chevrolet', 'Corvette ZR1', 1990, 'C4 con LT5 V8 32V cabezas DOHC desarrollado por Lotus. 375 CV en una época donde un Ferrari Testarossa daba 390. King of the Hill para sus dueños, polémico siempre.'),
  ('Chevrolet', 'Bel Air', 1957, 'Tres tonos disponibles, V8 small-block opcional y tail-fins legendarios. Una de las imágenes con las que cualquiera visualiza el Estados Unidos de los cincuenta. De las que mejor envejecieron.'),
  ('Chevrolet', 'Impala SS', 1994, 'Sedán full-size con motor LT1 5.7 del Corvette. Estética sleeper: exterior modesto, mecánica brutal. Solo cuatro años de producción, hoy es objeto de culto.'),
  ('Chevrolet', 'Corvette Stingray C8', 2019, 'Primer Corvette mid-engine. LT2 V8 6.2 atmosférico, transeje DCT de doble embrague y un cambio de paradigma para la marca después de 60 años de motor delantero.'),
  ('Dodge', 'Demon', 2018, 'Challenger con 6.2 supercomprimido HEMI de 840 CV. Homologado para drag: recibió neumáticos slick, modo de transferencia trasera de peso y la prohibición de su uso en NHRA por excesivamente bestia.'),
  ('Dodge', 'Challenger T/A', 1970, 'Homologación Trans-Am. 340 Six Pack (V8 5.6 con tres carburadores), escape lateral y un esquema gráfico que sigue siendo referencia 50 años después.'),
  ('Dodge', 'Stealth', 1990, 'Gemelo del Mitsubishi 3000GT. V6 3.0 biturbo, tracción AWD y direcciones a las cuatro ruedas. Tecnología japonesa, badge americano: un experimento de los noventa que no se repitió.'),
  ('Pontiac', 'Solstice', 2005, 'Roadster compacto con motor 2.4 atmosférico (o 2.0 turbo en versión GXP). Pensado para llegar a un comprador joven que ya no compraba Pontiac. Llegó tarde: la marca cerró cinco años después.'),
  ('Pontiac', 'Fiero', 1983, 'Primer Pontiac mid-engine. Plástico SMC en la carrocería, ingeniería ajustada y los primeros años motores demasiado modestos. Cuando por fin metieron el V6, GM cerró el proyecto.'),
  ('Cadillac', 'CTS-V', 2003, 'Sedán deportivo con motor LS6 V8 5.7 del Corvette Z06. Primera incursión seria de Cadillac en territorio M3, y base de la que parten todas las V-Series posteriores.'),
  ('Cadillac', 'Escalade', 1998, 'SUV de lujo cimentado en chasis Tahoe. Pivote cultural más allá de su mecánica: la cultura hip-hop lo subió a un pedestal del que no bajó.'),
  ('Jeep', 'Grand Cherokee SRT', 2011, 'SUV familiar con 6.4 HEMI atmosférico de 470 CV. La idea de meter una berlina deportiva americana en el chasis de un Cherokee: y que el coche pueda con todo.'),
  ('Jeep', 'Cherokee XJ', 1984, 'Primer SUV unibody, sin chasis de escalera. Pionero de un esquema que terminaría dominando el mercado entero. Producido hasta 2001 con casi cero cambios: virtud, no defecto.'),
  ('AMC', 'Pacer', 1975, 'Cupé burbuja con líneas anchas, lunas enormes y polémica visual desde el día uno. Diseñado para llevar un motor Wankel que nunca llegó. Wayne''s World rescató su imagen.'),
  ('Buick', 'Riviera', 1963, 'Primer Riviera. Personal luxury car con V8 401 y diseño Bill Mitchell. El intento de Buick por hacer un coche que compitiera con el Ford Thunderbird: lo consiguió por años.'),
  ('Oldsmobile', '442', 1968, 'Muscle car con V8 400 atmosférico. El número 442 venía de 4-barriles, 4-velocidades y 2 escapes: receta directa, ejecución brutal.'),
  ('Tesla', 'Model X', 2015, 'SUV eléctrico con puertas falcon, verticales con bisagras a la altura del techo. Concepto polémico, ejecución compleja. El coche que demostró que Tesla podía hacer algo más allá del Model S.'),
  ('Tesla', 'Cybertruck', 2023, 'Pickup eléctrico con carrocería de acero inoxidable plegado. Diseño que solo gusta o solo no, gris medio inexistente. Producción retrasada, demanda mantenida.'),
  ('Lincoln', 'Continental', 1961, 'Cuarta generación. Puertas suicidas, líneas Elwood Engel y la silueta del coche en el que asesinaron a Kennedy. Pieza histórica antes que automovilística.'),
  ('Saturn', 'Sky', 2006, 'Roadster gemelo del Pontiac Solstice. 2.4 atmosférico o 2.0 turbo. Saturn cerró tres años después de su lanzamiento: pieza casi inmediatamente de coleccionista.'),
  ('Plymouth', 'Road Runner', 1968, 'Muscle car asequible. 383 V8 de serie, opción 426 HEMI y bocina con sonido de caricatura. Estrategia de marketing: coche bruto para presupuestos cortos.'),

  -- Reino Unido (25)
  ('Aston Martin', 'DB9', 2003, 'Sucesor del DB7. V12 6.0 atmosférico de 450 CV, chasis VH de aluminio extrusionado y diseño Ian Callum-Henrik Fisker. Marcó el lenguaje estético de la marca por 15 años.'),
  ('Aston Martin', 'Vanquish', 2001, 'Última generación bajo Ford. V12 5.9 atmosférico, caja manual robotizada y producción artesanal en Newport Pagnell. Sucesor del DB7, James Bond en Muere otro día.'),
  ('Mclaren', 'Senna', 2018, 'Track hypercar sin concesiones estéticas. Aerodinámica activa con casi 800 kg de carga aerodinámica a 250 km/h, V8 4.0 biturbo de 800 CV y peso bajo 1.200 kg. Nombrada con permiso de la familia del piloto.'),
  ('Mclaren', 'Speedtail', 2019, 'Hypercar de tres plazas en línea (conductor central) y silueta que recupera la idea del McLaren F1. Híbrido de 1.050 CV, 403 km/h declarados. 106 unidades.'),
  ('Jaguar', 'XJS', 1975, 'Sucesor del E-Type y reto imposible: vino a heredar el coche más bonito jamás hecho. V12 5.3 atmosférico, GT cómodo, comercialmente exitoso. Resignación elegante.'),
  ('Jaguar', 'F-Type', 2012, 'Roadster (luego cupé) con V6 supercomprimido o V8 5.0 supercomprimido. El primer Jaguar deportivo verdadero en décadas: la marca tardó 35 años en hacer un sucesor digno del E-Type.'),
  ('Jaguar', 'Mark 2', 1959, 'Sedán deportivo de cuatro puertas. Inspector Morse al volante, Bonnie y Clyde de la era británica usándolo como coche de fuga. Tanto policía como gángster fiaron en él.'),
  ('Jaguar', 'XJR', 1994, 'Berlina XJ con seis en línea AJ16 supercomprimido de 326 CV. Sleeper británico: exterior conservador, mecánica desbordada. El M5 de los que no querían un BMW.'),
  ('Lotus', 'Exige', 2000, 'Cupé derivado del Elise. Construcción aluminio Lotus, 720 kg vacío y set-up dirigido al circuito. Filosofía Chapman (añadir ligereza) llevada al extremo razonable.'),
  ('Lotus', 'Evora', 2008, 'Cupé 2+2 con V6 3.5 Toyota atmosférico (o sobrecomprimido en versiones posteriores). Primer Lotus modernamente cómodo: concesión al uso diario sin desnaturalizar la marca.'),
  ('Tvr', 'Cerbera', 1996, 'Cupé artesanal con V8 Speed Eight desarrollado en casa. Sin ABS, sin control de tracción, sin airbags. Conducir uno requiere entrenamiento previo o gran fe.'),
  ('Tvr', 'Tuscan', 1999, 'Cupé con seis en línea Speed Six atmosférico hasta 400 CV. Diseño Damian McTaggart radical, interior tan british que duele. John Travolta lo condujo en Códigos de guerra.'),
  ('Bentley', 'Arnage', 1998, 'Sedán de lujo con V8 6.75 biturbo, bloque originario de los sesenta refinado año tras año. Última generación enteramente diseñada en Crewe antes de la era VW.'),
  ('Bentley', 'Mulsanne', 2010, 'Flagship Bentley con el mismo V8 6.75 biturbo de la casa, refinado al extremo. Última iteración del bloque histórico: la marca lo retiró en 2020 después de 60 años de servicio.'),
  ('Mini', 'John Cooper Works GP', 2020, 'Edición limitada a 3.000 unidades. 2.0 turbo de 306 CV, sin asientos traseros, suspensión de circuito y barra antivuelco rígida en lugar de los asientos retirados. Hot hatch sin filtros.'),
  ('Land Rover', 'Discovery', 1989, 'Primera generación. Plataforma del Range Rover original con carrocería más práctica, 4WD permanente y techo escalonado distintivo. El 4x4 que abrió Land Rover al comprador no aristocrático.'),
  ('Land Rover', 'Range Rover Sport SVR', 2014, 'SUV de lujo con V8 5.0 supercomprimido de 550 CV. Récord de Pikes Peak para SUV de producción y sonido inconfundible: el dispositivo de control de escape lo subió de categoría.'),
  ('Morgan', '3 Wheeler', 2011, 'Tricicleta con motor S&S V-twin expuesto al aire, transmisión manual y construcción puramente artesanal en Malvern. Más experiencia que medio de transporte.'),
  ('Reliant', 'Scimitar', 1968, 'GT británico con carrocería de fibra de vidrio sobre chasis de acero. La Princesa Ana tuvo varios, más de uno destrozado a velocidades imprudentes. Suficiente recomendación.'),
  ('Sunbeam', 'Tiger', 1964, 'Sunbeam Alpine convertido al V8 Ford pequeño bajo dirección de Carroll Shelby. Roadster ligero, motor brutal: la receta exacta que Shelby aplicó al Cobra unos años antes.'),
  ('Ginetta', 'G40', 2010, 'Race car homologable para calle. 1.8 Ford de 175 CV, peso bajo 800 kg y configuración de carreras de serie. Para llegar al circuito conduciéndolo desde casa.'),
  ('Vauxhall', 'Astra GTE', 1984, 'Hot hatch británico, hermano del Opel Astra GT/E, con motor 2.0 16V de 156 CV. Convivió con el Golf GTI Mk2 con dignidad y precio más accesible.'),
  ('Bristol', 'Blenheim', 1993, 'GT británico artesanal. V8 Chrysler, producción ínfima en talleres de Filton y ventas exclusivamente desde una sola concesionaria en Kensington. Más arquitectura que coche.'),
  ('Marcos', 'Mantis', 1971, 'Cupé esquinado con seis en línea Ford. Producción mínima (33 unidades), diseño polémico y la imagen de la fragilidad financiera crónica de Marcos. Hoy, rareza absoluta.'),
  ('Rover', 'SD1', 1976, 'Hatchback grande con línea descaradamente inspirada en el Ferrari Daytona. V8 3.5 disponible en versiones más potentes. Coche del Año Europa 1977 que la marca tardó en aprovechar.'),

  -- Francia (18)
  ('Peugeot', '504', 1968, 'Sedán y cupé robustos hasta el ridículo. Producción durante 38 años, ensamblaje en países donde otros coches no aguantaban una temporada. Coche del Año Europa 1969 y verdad asfáltica en África aún hoy.'),
  ('Peugeot', 'RCZ R', 2013, 'Cupé con techo de doble burbuja y 1.6 turbo de 270 CV, el cuatro cilindros más potente de la marca. Diseño que envejeció sorprendentemente bien y mecánica más fina de lo que sus rivales esperaban.'),
  ('Peugeot', '308 GTi', 2015, 'Hot hatch con motor 1.6 turbo de 270 CV en versión más potente. Suspensión Torsen, frenos Alcon: equipo de adultos para un compacto. Convivió con Megane RS y Civic Type R cuando la categoría brillaba.'),
  ('Peugeot', '405 T16', 1992, 'Versión de carretera del 405 con motor 2.0 turbo de 220 CV, AWD permanente y dirección a las cuatro ruedas. Producido para homologar el rally. Ari Vatanen ganó el Paris-Dakar con la versión competición.'),
  ('Renault', 'Mégane RS', 2014, 'Hot hatch con 2.0 turbo, suspensión Cup opcional y diferencial mecánico Torsen. Récord de Nürburgring para FWD en la versión Trophy R. La rivalidad con Civic Type R y Golf R definía el segmento.'),
  ('Renault', 'Avantime', 2001, 'Cupé-monovolumen único en su categoría, porque nadie más se atrevió. Puertas dobles articuladas, techo eléctrico y un fracaso comercial inmediato. Hoy es rareza buscada.'),
  ('Renault', 'Espace', 1984, 'Primer monovolumen europeo de producción. Plataforma Matra-Renault, plásticos por todas partes y un concepto que generó un segmento entero. Vendido bajo licencia incluso en Estados Unidos.'),
  ('Renault', 'Twingo', 1992, 'Microcompacto divertido con motor 1.2 y diseño tipo bloque de juguete. Asientos delanteros corridos, plástico colorido, asequibilidad genuina: un coche pensado para ser barato sin sentirlo.'),
  ('Renault', 'Alpine A310', 1971, 'Sucesor de la A110. Cupé fastback con V6 PRV 2.7 atmosférico central, primer V6 de la alianza francotalitalo-sueca. Tracción trasera, peso ligero, comportamiento exigente.'),
  ('Citroen', '2CV', 1948, 'Utilitario popular francés con motor bicilíndrico bóxer refrigerado por aire y suspensión que parece de muelles de cama. Diseñado para llevar dos campesinos, 50 kg de patatas y una cesta de huevos sin que se rompiera ninguno.'),
  ('Citroen', 'BX GTi', 1986, 'Sedán deportivo con suspensión hidroneumática y motor 1.9 inyectado de 122 CV. Diseño Gandini, autocaravana de carácter en versión asequible.'),
  ('Citroen', 'Xantia Activa', 1994, 'Berlina con suspensión Hydractive y SC.CAR antibalanceo activo. Ostenta el récord mundial de slalom de Teknikens Värld desde 1999: nadie le ha quitado el podio, ni un Huracán Evo lo ha conseguido.'),
  ('Citroen', 'SM', 1970, 'Cupé GT con V6 Maserati, suspensión hidroneumática, faros direccionales y dirección DIRAVI auto-centrante. Tecnología de los setenta delirante en una marca que entonces se permitía cualquier cosa.'),
  ('Citroen', 'CX', 1974, 'Berlina aerodinámica (Cx 0.36 al lanzamiento) con suspensión hidroneumática y diseño Robert Opron tangente a la perfección. Coche del Año Europa 1975.'),
  ('Alpine', 'A610', 1991, 'Cupé GT con V6 PRV 3.0 turbo central, sucesor de la A310. Última Alpine antes de la hibernación. Tracción trasera, manejo exigente, producción mínima.'),
  ('Alpine', 'A110 Nueva', 2017, 'Relanzamiento de la marca tras décadas dormida. 1.8 turbo de 252 CV, peso pluma (1.080 kg), suspensión Sachs y un comportamiento exquisito en condiciones reales. Crítica unánime, ventas más modestas.'),
  ('Venturi', '400 GT', 1994, 'Supercar francés artesanal con V6 PRV biturbo de 408 CV. Construcción de bastidor de tubo de acero y carrocería compuesta. Convivió con el Bugatti EB110 demostrando que Francia podía hacer hypercars.'),
  ('Matra', 'Murena', 1980, 'Cupé mid-engine con asientos en línea para tres adultos, único en concepto. Cuatro cilindros 1.6 o 2.2 atmosférico Talbot, configuración rara, fabricación artesanal en talleres Matra.'),

  -- España (8)
  ('Seat', '600', 1957, 'Licencia del Fiat 600. El coche que motorizó España y el coche que estuvo en la primera generación de viajes familiares a la playa. Bicilíndrico 633 cc, 4 plazas teóricas, mucho menos en realidad.'),
  ('Seat', '124', 1968, 'Sedán familiar con licencia Fiat. Base del 124 Sport, del 1430 y de buena parte del Mundial de Rally de los setenta: la versión 1800 compitió en alta categoría.'),
  ('Seat', 'León Cupra', 2014, 'Hot hatch con 2.0 TSI de 280 CV en versión más potente. La cuarta generación de Cupra dentro de Seat antes de que la marca se separara: la receta funcionaba y la marca se ganó su independencia.'),
  ('Seat', 'Ateca Cupra', 2018, 'Primer SUV deportivo de Cupra todavía bajo el paraguas Seat. 2.0 TSI de 300 CV y tracción 4Drive. Coche de transición: cuando se lanzó, ya estaba decidida la independencia de marca.'),
  ('Cupra', 'Formentor', 2020, 'Primer modelo concebido íntegramente bajo la marca independiente Cupra. Crossover-cupé, gama amplia desde híbrido enchufable hasta 2.5 TSI cinco cilindros de 390 CV. La apuesta funcionó: es ya el más vendido de la marca.'),
  ('Hispano-Suiza', 'Carmen', 2019, 'Hypercar eléctrico con estética art déco recuperada de la marca histórica. 1.114 CV, carrocería de fibra de carbono y producción artesanal de 19 unidades, una por cada año del modelo original H6 que inspiró el rebautizo.'),
  ('Pegaso', 'Z-102', 1951, 'Supercar español de postguerra desarrollado por Wifredo Ricart, ex-Alfa Romeo. V8 atmosférico, caja transeje y velocidad punta superior al Ferrari 250 contemporáneo. 86 unidades, una declaración.'),
  ('GTA', 'Spano', 2010, 'Supercar valenciano artesanal con V10 5.2 atmosférico (luego 8.4 biturbo en GTA Spano 2013). Producción ínfima, exotismo total: España posicionándose en el mapa hypercar.'),

  -- Corea del Sur (5)
  ('Kia', 'Stinger GT', 2017, 'Fastback de cinco puertas con V6 3.3 biturbo de 365 CV, propulsión trasera o tracción total. Diseñado por Peter Schreyer, calibrado por Albert Biermann ex-BMW M. Primera berlina coreana en jugar la liga de las premium europeas.'),
  ('Kia', 'EV6 GT', 2022, 'Crossover eléctrico con 585 CV, dos motores y tracción total. 0-100 km/h en 3.5 segundos. Demostración de que la plataforma E-GMP de Hyundai-Kia da para hacer cosas muy serias.'),
  ('Genesis', 'G70', 2017, 'Sedán deportivo con motor 2.0 turbo o V6 3.3 biturbo. Rival directo del BMW 3 Series: pequeño en su lanzamiento, ya consolidado tras años de iteración. Hyundai jugando en serio en el segmento premium.'),
  ('Hyundai', 'Pony', 1975, 'Primer coche coreano de producción masiva. Diseño Giorgetto Giugiaro, mecánica Mitsubishi y producción nacional: la receta con la que Hyundai pasó de ensamblar Ford a fabricar lo suyo. Inicio absoluto.'),
  ('Hyundai', 'Ioniq 5 N', 2024, 'Crossover eléctrico con 650 CV en versión más bestia, sonido sintético elaborado por departamento dedicado y modos N e-Shift que simulan cambios de marcha en un coche sin caja. Ingeniería con sentido del humor.'),

  -- Suecia (4)
  ('Volvo', '240', 1974, 'Berlina y ranchera con motorización desde diésel atmosférico hasta turbo gasolina. Construcción indestructible: base de buena parte del parque taxistas en Estados Unidos durante décadas. Sleeper en versión turbo.'),
  ('Volvo', 'P1800', 1961, 'Cupé elegante con cuatro en línea, líneas suaves Pelle Petterson y carrocería inicialmente fabricada por Jensen en Inglaterra. Roger Moore lo conducía como Simon Templar en El Santo: promoción que la marca no necesitó pagar.'),
  ('Saab', 'Sonett', 1966, 'Pequeño cupé deportivo con motor de dos tiempos tres cilindros (luego V4 Ford). Producción mínima, peso pluma, concepto rarísimo dentro del catálogo Saab de su época.'),
  ('Koenigsegg', 'Jesko', 2019, 'Hypercar sueco con V8 5.0 biturbo y combustible alternativo E85, hasta 1.600 CV. Caja LST de nueve velocidades con embragues múltiples, todo desarrollado in-house en Ängelholm.'),

  -- Otros (5)
  ('Tatra', 'T87', 1937, 'Sedán aerodinámico checoslovaco con V8 atmosférico refrigerado por aire en posición trasera. Coeficiente Cx 0.36 desarrollado por Hans Ledwinka, técnico de quien Ferdinand Porsche aprendió mucho más de lo que reconoció. Erwin Rommel lo conducía.'),
  ('Skoda', 'Felicia', 1959, 'Descapotable de la era checoslovaca con motor cuatro cilindros 1.1 atmosférico. Producción modesta, exportación amplia: el coche con el que Skoda demostraba que se podía hacer algo más allá de la línea utilitaria habitual.'),
  ('Dacia', '1300', 1969, 'Versión rumana del Renault 12 construida bajo licencia. Producido durante décadas con cero cambios sustanciales, coche típico de Bucarest hasta los noventa. La base del Logan moderno hereda más de aquí de lo que parece.'),
  ('GAZ', 'Volga 21', 1956, 'Sedán soviético clásico: el coche del KGB, del partido y de los taxis estatales. Cuatro cilindros 2.4 atmosférico, construcción tosca, fiabilidad infinita en condiciones siberianas.'),
  ('DAF', '33', 1967, 'Pequeño coche holandés con transmisión Variomatic CVT, primer coche de calle con esa tecnología. Conducción rara, dos cilindros refrigerados por aire. Adelantado a su tiempo en un sentido raro.')
) AS v(make, model, year, descr)
WHERE c.make = v.make
  AND c.model = v.model
  AND c.year = v.year
  AND c.description IS NULL;


-- =============================================================================
-- [VERIFICACIÓN] Cuenta los que se actualizaron y los que quedaron sin pareja
-- =============================================================================
-- Si no hubo errores tipográficos en marca/modelo/año entre el batch de
-- inserts y este de descriptions, los 200 deberían quedar con description.
-- Si alguno quedó sin emparejar (typo), aparecerá aquí.

SELECT
  COUNT(*) FILTER (WHERE description IS NULL AND image_ready = FALSE) AS sin_descripcion_draft,
  COUNT(*) FILTER (WHERE description IS NOT NULL AND image_ready = FALSE) AS con_descripcion_draft
FROM public.cars;


-- =============================================================================
-- [SIGUIENTE PASO] Traducir a inglés con DeepL
-- =============================================================================
-- Tras correr este SQL, ejecuta desde la raíz del proyecto:
--
--   node scripts/translate-existing-descriptions.js
--
-- El script existente ya hace el trabajo: lee coches con description != NULL
-- y description_en = NULL, traduce con DeepL y persiste. Idempotente y seguro
-- de re-correr. Necesita DEEPL_API_KEY en tu .env (ya la tienes configurada
-- si el script de traducciones se ha usado antes).
