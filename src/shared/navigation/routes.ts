import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  Calculator,
  CalendarDays,
  Clock,
  FolderKanban,
  Home,
  Package,
  Settings,
  Share2,
  ShoppingBag,
  Users,
} from 'lucide-react';

export type ModuleRouteId =
  | 'dashboard'
  | 'projects'
  | 'timer'
  | 'inventory'
  | 'shopping'
  | 'quoting'
  | 'clients'
  | 'planner'
  | 'patterns'
  | 'social'
  | 'settings';

export type NavigationGroup =
  | 'Operación'
  | 'Materiales'
  | 'Comercial'
  | 'Crecimiento'
  | 'Sistema';

export interface ModuleRouteDefinition {
  readonly id: ModuleRouteId;
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
  readonly group: NavigationGroup;
  readonly phase: number;
  readonly isActiveInCurrentPhase: boolean;
  readonly icon: LucideIcon;
  readonly showInMobileBottomBar: boolean;
  readonly plannedCapabilities: string[];
}

export const MODULE_ROUTES: ModuleRouteDefinition[] = [
  {
    id: 'dashboard',
    label: 'Panel Principal',
    shortLabel: 'Inicio',
    description: 'Resumen del taller, proyectos activos, alertas y flujo financiero.',
    group: 'Operación',
    phase: 1,
    isActiveInCurrentPhase: true,
    icon: Home,
    showInMobileBottomBar: true,
    plannedCapabilities: [
      'Indicadores reales de proyectos en curso, pendientes y finalizados',
      'Alertas de stock bajo por color y entregas próximas',
      'Resumen de saldos y cobros pendientes en COP',
    ],
  },
  {
    id: 'projects',
    label: 'Proyectos',
    shortLabel: 'Proyectos',
    description: 'Creación de proyectos, componentes por piezas y seguimiento de avance.',
    group: 'Operación',
    phase: 2,
    isActiveInCurrentPhase: true,
    icon: FolderKanban,
    showInMobileBottomBar: true,
    plannedCapabilities: [
      'Gestión de proyectos propios o encargos de clientes',
      'División por componentes (ej. tronco, alas, antenas, ensamblaje)',
      'Control de estados y metas de tiempo por proyecto',
    ],
  },
  {
    id: 'timer',
    label: 'Cronómetro',
    shortLabel: 'Tiempo',
    description: 'Medición persistente de tiempo real y efectivo por componente.',
    group: 'Operación',
    phase: 3,
    isActiveInCurrentPhase: true,
    icon: Clock,
    showInMobileBottomBar: true,
    plannedCapabilities: [
      'Recuperación exacta por marcas de tiempo si cierras el navegador',
      'Bloqueo de sesiones simultáneas para evitar conteos dobles',
      'Mini-reproductor flotante en el espacio reservado del taller',
    ],
  },
  {
    id: 'inventory',
    label: 'Inventario',
    shortLabel: 'Inventario',
    description: 'Stock por color, reservas compartidas entre proyectos y Kardex inmutable.',
    group: 'Materiales',
    phase: 4,
    isActiveInCurrentPhase: true,
    icon: Package,
    showInMobileBottomBar: true,
    plannedCapabilities: [
      'Diferenciación obligatoria de hilos y lanas por color',
      'Cálculo automático de físico, reservado, disponible y consumido',
      'Historial inmutable de reservas, consumos y ajustes',
    ],
  },
  {
    id: 'shopping',
    label: 'Compras y Notas',
    shortLabel: 'Compras',
    description: 'Materiales pendientes, notas rápidas, listas de compra y recepciones.',
    group: 'Materiales',
    phase: 5,
    isActiveInCurrentPhase: true,
    icon: ShoppingBag,
    showInMobileBottomBar: false,
    plannedCapabilities: [
      'Registro de materiales faltantes vinculados a componentes bloqueados',
      'Diferenciación entre comprado en camino y recibido en stock',
      'Recepciones totales o parciales con suma automática al inventario',
    ],
  },
  {
    id: 'quoting',
    label: 'Cotizador',
    shortLabel: 'Cotizar',
    description: 'Cálculo transparente de costos, mano de obra, Markup y margen real en COP.',
    group: 'Comercial',
    phase: 6,
    isActiveInCurrentPhase: false,
    icon: Calculator,
    showInMobileBottomBar: false,
    plannedCapabilities: [
      'Lectura directa de tiempos efectivos y consumo de materiales',
      'Cálculo con fórmula Markup + visualización del margen real sobre venta',
      'Simulación en vivo de tarifa por hora, empaque e indirectos',
    ],
  },
  {
    id: 'clients',
    label: 'Clientes y Pagos',
    shortLabel: 'Clientes',
    description: 'Directorio de clientes, anticipos, cuotas, pagos parciales y saldos.',
    group: 'Comercial',
    phase: 7,
    isActiveInCurrentPhase: false,
    icon: Users,
    showInMobileBottomBar: false,
    plannedCapabilities: [
      'Planes de pago flexibles: contado, anticipo y cuotas',
      'Registro inmutable de abonos parciales y saldos pendientes',
      'Separación estricta entre caja de clientes y costos del taller',
    ],
  },
  {
    id: 'planner',
    label: 'Planificación y Agenda',
    shortLabel: 'Agenda',
    description: 'Metas diarias, calendario y dependencias con materiales pendientes.',
    group: 'Operación',
    phase: 8,
    isActiveInCurrentPhase: false,
    icon: CalendarDays,
    showInMobileBottomBar: false,
    plannedCapabilities: [
      'Agenda diaria vinculada a piezas y disponibilidad de insumos',
      'Bloqueo preventivo de tareas cuyo material aún no llega',
      'Recordatorios configurables de entregas, cuotas y compras',
    ],
  },
  {
    id: 'patterns',
    label: 'Biblioteca de Patrones',
    shortLabel: 'Patrones',
    description: 'Catálogo de patrones propios, gratuitos y adquiridos con control de acceso.',
    group: 'Crecimiento',
    phase: 9,
    isActiveInCurrentPhase: false,
    icon: BookOpen,
    showInMobileBottomBar: false,
    plannedCapabilities: [
      'Filtros por categoría, dificultad y materiales requeridos',
      'Protección de instrucciones completas en patrones de pago',
      'Creación directa de un proyecto a partir de un patrón',
    ],
  },
  {
    id: 'social',
    label: 'Contenido y Redes',
    shortLabel: 'Redes',
    description: 'Organización de grabaciones, hooks y publicaciones por etapa del tejido.',
    group: 'Crecimiento',
    phase: 10,
    isActiveInCurrentPhase: false,
    icon: Share2,
    showInMobileBottomBar: false,
    plannedCapabilities: [
      'Lista de grabación por etapa: inicio, piezas, ensamblaje y resultado',
      'Calendario de publicación para TikTok e Instagram Reels',
      'Vinculación directa con los componentes del proyecto',
    ],
  },
  {
    id: 'settings',
    label: 'Taller y Respaldos',
    shortLabel: 'Taller',
    description: 'Configuración base, respaldo seguro (Exportar/Importar) y datos de ejemplo.',
    group: 'Sistema',
    phase: 1,
    isActiveInCurrentPhase: true,
    icon: Settings,
    showInMobileBottomBar: true,
    plannedCapabilities: [
      'Configuración persistente de tarifa por hora y metas en IndexedDB',
      'Exportación e importación validada con protección contra sobrescritura',
      'Carga y eliminación transaccional de datos de demostración',
    ],
  },
];

export const NAVIGATION_GROUPS: NavigationGroup[] = [
  'Operación',
  'Materiales',
  'Comercial',
  'Crecimiento',
  'Sistema',
];

export function getRouteDefinition(id: ModuleRouteId): ModuleRouteDefinition {
  return MODULE_ROUTES.find((r) => r.id === id) ?? MODULE_ROUTES[0];
}
