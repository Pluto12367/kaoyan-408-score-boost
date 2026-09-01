import type { RoleSection } from '../../../layouts/RoleNavigation';
import type { StudentActionDestination } from './studentAction';

const DESTINATION_TO_SECTION: Record<StudentActionDestination, RoleSection> = {
  home: 'dashboard',
  practice: 'question',
  knowledge: 'knowledge-catalog',
  review: 'wrong-book',
  test: 'test',
  ai: 'ai',
};

const STUDENT_ACTION_DESTINATIONS = new Set<StudentActionDestination>(Object.keys(DESTINATION_TO_SECTION) as StudentActionDestination[]);

export function toRoleSection(destination: StudentActionDestination): RoleSection {
  return DESTINATION_TO_SECTION[destination];
}

export function isStudentActionDestination(value: unknown): value is StudentActionDestination {
  return typeof value === 'string' && STUDENT_ACTION_DESTINATIONS.has(value as StudentActionDestination);
}
