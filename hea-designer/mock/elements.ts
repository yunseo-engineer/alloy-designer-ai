export type Category =
  | "alkali"
  | "alkaline-earth"
  | "lanthanide"
  | "actinide"
  | "transition"
  | "post-transition"
  | "metalloid"
  | "reactive-nonmetal"
  | "noble-gas"
  | "unknown";

export type MatterState = "gas" | "liquid" | "solid" | "unknown";

export interface ElementData {
  number: number;
  symbol: string;
  name: string;
  weight: string;
  category: Category;
  state: MatterState;
  row: number;
  col: number;
  selectable: boolean;
  vec?: number;
  tm?: number; // melting point, K
  radius?: number; // metallic radius, pm
}

export interface PlaceholderCell {
  row: number;
  col: number;
  label: string;
  sublabel: string;
}

// The two footnote cells inside the main grid that point down to the
// lanthanide / actinide rows rendered separately below the table.
export const PLACEHOLDER_CELLS: PlaceholderCell[] = [
  { row: 6, col: 3, label: "57-71", sublabel: "Lanthanoids" },
  { row: 7, col: 3, label: "89-103", sublabel: "Actinoids" },
];

export const ELEMENTS: ElementData[] = [
  { number: 1, symbol: "H", name: "Hydrogen", weight: "1.008", category: "reactive-nonmetal", state: "gas", row: 1, col: 1, selectable: true },
  { number: 2, symbol: "He", name: "Helium", weight: "4.003", category: "noble-gas", state: "gas", row: 1, col: 18, selectable: true },

  { number: 3, symbol: "Li", name: "Lithium", weight: "6.94", category: "alkali", state: "solid", row: 2, col: 1, selectable: true },
  { number: 4, symbol: "Be", name: "Beryllium", weight: "9.012", category: "alkaline-earth", state: "solid", row: 2, col: 2, selectable: true },
  { number: 5, symbol: "B", name: "Boron", weight: "10.81", category: "metalloid", state: "solid", row: 2, col: 13, selectable: true },
  { number: 6, symbol: "C", name: "Carbon", weight: "12.011", category: "reactive-nonmetal", state: "solid", row: 2, col: 14, selectable: true },
  { number: 7, symbol: "N", name: "Nitrogen", weight: "14.007", category: "reactive-nonmetal", state: "gas", row: 2, col: 15, selectable: true },
  { number: 8, symbol: "O", name: "Oxygen", weight: "15.999", category: "reactive-nonmetal", state: "gas", row: 2, col: 16, selectable: true },
  { number: 9, symbol: "F", name: "Fluorine", weight: "18.998", category: "reactive-nonmetal", state: "gas", row: 2, col: 17, selectable: true },
  { number: 10, symbol: "Ne", name: "Neon", weight: "20.180", category: "noble-gas", state: "gas", row: 2, col: 18, selectable: true },

  { number: 11, symbol: "Na", name: "Sodium", weight: "22.990", category: "alkali", state: "solid", row: 3, col: 1, selectable: true },
  { number: 12, symbol: "Mg", name: "Magnesium", weight: "24.305", category: "alkaline-earth", state: "solid", row: 3, col: 2, selectable: true },
  { number: 13, symbol: "Al", name: "Aluminium", weight: "26.982", category: "post-transition", state: "solid", row: 3, col: 13, selectable: true, vec: 3, tm: 933, radius: 143 },
  { number: 14, symbol: "Si", name: "Silicon", weight: "28.085", category: "metalloid", state: "solid", row: 3, col: 14, selectable: true },
  { number: 15, symbol: "P", name: "Phosphorus", weight: "30.974", category: "reactive-nonmetal", state: "solid", row: 3, col: 15, selectable: true },
  { number: 16, symbol: "S", name: "Sulfur", weight: "32.06", category: "reactive-nonmetal", state: "solid", row: 3, col: 16, selectable: true },
  { number: 17, symbol: "Cl", name: "Chlorine", weight: "35.45", category: "reactive-nonmetal", state: "gas", row: 3, col: 17, selectable: true },
  { number: 18, symbol: "Ar", name: "Argon", weight: "39.948", category: "noble-gas", state: "gas", row: 3, col: 18, selectable: true },

  { number: 19, symbol: "K", name: "Potassium", weight: "39.098", category: "alkali", state: "solid", row: 4, col: 1, selectable: true },
  { number: 20, symbol: "Ca", name: "Calcium", weight: "40.078", category: "alkaline-earth", state: "solid", row: 4, col: 2, selectable: true },
  { number: 21, symbol: "Sc", name: "Scandium", weight: "44.956", category: "transition", state: "solid", row: 4, col: 3, selectable: true },
  { number: 22, symbol: "Ti", name: "Titanium", weight: "47.867", category: "transition", state: "solid", row: 4, col: 4, selectable: true, vec: 4, tm: 1941, radius: 147 },
  { number: 23, symbol: "V", name: "Vanadium", weight: "50.942", category: "transition", state: "solid", row: 4, col: 5, selectable: true, vec: 5, tm: 2183, radius: 134 },
  { number: 24, symbol: "Cr", name: "Chromium", weight: "51.996", category: "transition", state: "solid", row: 4, col: 6, selectable: true, vec: 6, tm: 2180, radius: 128 },
  { number: 25, symbol: "Mn", name: "Manganese", weight: "54.938", category: "transition", state: "solid", row: 4, col: 7, selectable: true },
  { number: 26, symbol: "Fe", name: "Iron", weight: "55.845", category: "transition", state: "solid", row: 4, col: 8, selectable: true },
  { number: 27, symbol: "Co", name: "Cobalt", weight: "58.933", category: "transition", state: "solid", row: 4, col: 9, selectable: true },
  { number: 28, symbol: "Ni", name: "Nickel", weight: "58.693", category: "transition", state: "solid", row: 4, col: 10, selectable: true },
  { number: 29, symbol: "Cu", name: "Copper", weight: "63.546", category: "transition", state: "solid", row: 4, col: 11, selectable: true },
  { number: 30, symbol: "Zn", name: "Zinc", weight: "65.38", category: "transition", state: "solid", row: 4, col: 12, selectable: true },
  { number: 31, symbol: "Ga", name: "Gallium", weight: "69.723", category: "post-transition", state: "solid", row: 4, col: 13, selectable: true },
  { number: 32, symbol: "Ge", name: "Germanium", weight: "72.630", category: "metalloid", state: "solid", row: 4, col: 14, selectable: true },
  { number: 33, symbol: "As", name: "Arsenic", weight: "74.922", category: "metalloid", state: "solid", row: 4, col: 15, selectable: true },
  { number: 34, symbol: "Se", name: "Selenium", weight: "78.971", category: "reactive-nonmetal", state: "solid", row: 4, col: 16, selectable: true },
  { number: 35, symbol: "Br", name: "Bromine", weight: "79.904", category: "reactive-nonmetal", state: "liquid", row: 4, col: 17, selectable: true },
  { number: 36, symbol: "Kr", name: "Krypton", weight: "83.798", category: "noble-gas", state: "gas", row: 4, col: 18, selectable: true },

  { number: 37, symbol: "Rb", name: "Rubidium", weight: "85.468", category: "alkali", state: "solid", row: 5, col: 1, selectable: true },
  { number: 38, symbol: "Sr", name: "Strontium", weight: "87.62", category: "alkaline-earth", state: "solid", row: 5, col: 2, selectable: true },
  { number: 39, symbol: "Y", name: "Yttrium", weight: "88.906", category: "transition", state: "solid", row: 5, col: 3, selectable: true },
  { number: 40, symbol: "Zr", name: "Zirconium", weight: "91.224", category: "transition", state: "solid", row: 5, col: 4, selectable: true, vec: 4, tm: 2128, radius: 160 },
  { number: 41, symbol: "Nb", name: "Niobium", weight: "92.906", category: "transition", state: "solid", row: 5, col: 5, selectable: true, vec: 5, tm: 2750, radius: 146 },
  { number: 42, symbol: "Mo", name: "Molybdenum", weight: "95.95", category: "transition", state: "solid", row: 5, col: 6, selectable: true, vec: 6, tm: 2896, radius: 139 },
  { number: 43, symbol: "Tc", name: "Technetium", weight: "(98)", category: "transition", state: "solid", row: 5, col: 7, selectable: true },
  { number: 44, symbol: "Ru", name: "Ruthenium", weight: "101.07", category: "transition", state: "solid", row: 5, col: 8, selectable: true },
  { number: 45, symbol: "Rh", name: "Rhodium", weight: "102.906", category: "transition", state: "solid", row: 5, col: 9, selectable: true },
  { number: 46, symbol: "Pd", name: "Palladium", weight: "106.42", category: "transition", state: "solid", row: 5, col: 10, selectable: true },
  { number: 47, symbol: "Ag", name: "Silver", weight: "107.868", category: "transition", state: "solid", row: 5, col: 11, selectable: true },
  { number: 48, symbol: "Cd", name: "Cadmium", weight: "112.414", category: "transition", state: "solid", row: 5, col: 12, selectable: true },
  { number: 49, symbol: "In", name: "Indium", weight: "114.818", category: "post-transition", state: "solid", row: 5, col: 13, selectable: true },
  { number: 50, symbol: "Sn", name: "Tin", weight: "118.710", category: "post-transition", state: "solid", row: 5, col: 14, selectable: true },
  { number: 51, symbol: "Sb", name: "Antimony", weight: "121.760", category: "metalloid", state: "solid", row: 5, col: 15, selectable: true },
  { number: 52, symbol: "Te", name: "Tellurium", weight: "127.60", category: "metalloid", state: "solid", row: 5, col: 16, selectable: true },
  { number: 53, symbol: "I", name: "Iodine", weight: "126.904", category: "reactive-nonmetal", state: "solid", row: 5, col: 17, selectable: true },
  { number: 54, symbol: "Xe", name: "Xenon", weight: "131.293", category: "noble-gas", state: "gas", row: 5, col: 18, selectable: true },

  { number: 55, symbol: "Cs", name: "Caesium", weight: "132.905", category: "alkali", state: "solid", row: 6, col: 1, selectable: true },
  { number: 56, symbol: "Ba", name: "Barium", weight: "137.327", category: "alkaline-earth", state: "solid", row: 6, col: 2, selectable: true },
  { number: 72, symbol: "Hf", name: "Hafnium", weight: "178.49", category: "transition", state: "solid", row: 6, col: 4, selectable: true, vec: 4, tm: 2506, radius: 159 },
  { number: 73, symbol: "Ta", name: "Tantalum", weight: "180.948", category: "transition", state: "solid", row: 6, col: 5, selectable: true, vec: 5, tm: 3290, radius: 146 },
  { number: 74, symbol: "W", name: "Tungsten", weight: "183.84", category: "transition", state: "solid", row: 6, col: 6, selectable: true, vec: 6, tm: 3695, radius: 139 },
  { number: 75, symbol: "Re", name: "Rhenium", weight: "186.207", category: "transition", state: "solid", row: 6, col: 7, selectable: true },
  { number: 76, symbol: "Os", name: "Osmium", weight: "190.23", category: "transition", state: "solid", row: 6, col: 8, selectable: true },
  { number: 77, symbol: "Ir", name: "Iridium", weight: "192.217", category: "transition", state: "solid", row: 6, col: 9, selectable: true },
  { number: 78, symbol: "Pt", name: "Platinum", weight: "195.085", category: "transition", state: "solid", row: 6, col: 10, selectable: true },
  { number: 79, symbol: "Au", name: "Gold", weight: "196.967", category: "transition", state: "solid", row: 6, col: 11, selectable: true },
  { number: 80, symbol: "Hg", name: "Mercury", weight: "200.592", category: "transition", state: "liquid", row: 6, col: 12, selectable: true },
  { number: 81, symbol: "Tl", name: "Thallium", weight: "204.383", category: "post-transition", state: "solid", row: 6, col: 13, selectable: true },
  { number: 82, symbol: "Pb", name: "Lead", weight: "207.2", category: "post-transition", state: "solid", row: 6, col: 14, selectable: true },
  { number: 83, symbol: "Bi", name: "Bismuth", weight: "208.980", category: "post-transition", state: "solid", row: 6, col: 15, selectable: true },
  { number: 84, symbol: "Po", name: "Polonium", weight: "(209)", category: "post-transition", state: "solid", row: 6, col: 16, selectable: true },
  { number: 85, symbol: "At", name: "Astatine", weight: "(210)", category: "metalloid", state: "solid", row: 6, col: 17, selectable: true },
  { number: 86, symbol: "Rn", name: "Radon", weight: "(222)", category: "noble-gas", state: "gas", row: 6, col: 18, selectable: true },

  { number: 87, symbol: "Fr", name: "Francium", weight: "(223)", category: "alkali", state: "solid", row: 7, col: 1, selectable: true },
  { number: 88, symbol: "Ra", name: "Radium", weight: "(226)", category: "alkaline-earth", state: "solid", row: 7, col: 2, selectable: true },
  { number: 104, symbol: "Rf", name: "Rutherfordium", weight: "(267)", category: "transition", state: "unknown", row: 7, col: 4, selectable: true },
  { number: 105, symbol: "Db", name: "Dubnium", weight: "(268)", category: "transition", state: "unknown", row: 7, col: 5, selectable: true },
  { number: 106, symbol: "Sg", name: "Seaborgium", weight: "(269)", category: "transition", state: "unknown", row: 7, col: 6, selectable: true },
  { number: 107, symbol: "Bh", name: "Bohrium", weight: "(270)", category: "transition", state: "unknown", row: 7, col: 7, selectable: true },
  { number: 108, symbol: "Hs", name: "Hassium", weight: "(269)", category: "transition", state: "unknown", row: 7, col: 8, selectable: true },
  { number: 109, symbol: "Mt", name: "Meitnerium", weight: "(278)", category: "transition", state: "unknown", row: 7, col: 9, selectable: true },
  { number: 110, symbol: "Ds", name: "Darmstadtium", weight: "(281)", category: "transition", state: "unknown", row: 7, col: 10, selectable: true },
  { number: 111, symbol: "Rg", name: "Roentgenium", weight: "(282)", category: "transition", state: "unknown", row: 7, col: 11, selectable: true },
  { number: 112, symbol: "Cn", name: "Copernicium", weight: "(285)", category: "transition", state: "unknown", row: 7, col: 12, selectable: true },
  { number: 113, symbol: "Nh", name: "Nihonium", weight: "(286)", category: "unknown", state: "unknown", row: 7, col: 13, selectable: true },
  { number: 114, symbol: "Fl", name: "Flerovium", weight: "(289)", category: "unknown", state: "unknown", row: 7, col: 14, selectable: true },
  { number: 115, symbol: "Mc", name: "Moscovium", weight: "(290)", category: "unknown", state: "unknown", row: 7, col: 15, selectable: true },
  { number: 116, symbol: "Lv", name: "Livermorium", weight: "(293)", category: "unknown", state: "unknown", row: 7, col: 16, selectable: true },
  { number: 117, symbol: "Ts", name: "Tennessine", weight: "(294)", category: "unknown", state: "unknown", row: 7, col: 17, selectable: true },
  { number: 118, symbol: "Og", name: "Oganesson", weight: "(294)", category: "unknown", state: "unknown", row: 7, col: 18, selectable: true },

  // Lanthanoids — rendered as a separate row (8) beneath the main grid
  { number: 57, symbol: "La", name: "Lanthanum", weight: "138.905", category: "lanthanide", state: "solid", row: 8, col: 3, selectable: true },
  { number: 58, symbol: "Ce", name: "Cerium", weight: "140.116", category: "lanthanide", state: "solid", row: 8, col: 4, selectable: true },
  { number: 59, symbol: "Pr", name: "Praseodymium", weight: "140.908", category: "lanthanide", state: "solid", row: 8, col: 5, selectable: true },
  { number: 60, symbol: "Nd", name: "Neodymium", weight: "144.242", category: "lanthanide", state: "solid", row: 8, col: 6, selectable: true },
  { number: 61, symbol: "Pm", name: "Promethium", weight: "(145)", category: "lanthanide", state: "unknown", row: 8, col: 7, selectable: true },
  { number: 62, symbol: "Sm", name: "Samarium", weight: "150.36", category: "lanthanide", state: "solid", row: 8, col: 8, selectable: true },
  { number: 63, symbol: "Eu", name: "Europium", weight: "151.964", category: "lanthanide", state: "solid", row: 8, col: 9, selectable: true },
  { number: 64, symbol: "Gd", name: "Gadolinium", weight: "157.25", category: "lanthanide", state: "solid", row: 8, col: 10, selectable: true },
  { number: 65, symbol: "Tb", name: "Terbium", weight: "158.925", category: "lanthanide", state: "solid", row: 8, col: 11, selectable: true },
  { number: 66, symbol: "Dy", name: "Dysprosium", weight: "162.500", category: "lanthanide", state: "solid", row: 8, col: 12, selectable: true },
  { number: 67, symbol: "Ho", name: "Holmium", weight: "164.930", category: "lanthanide", state: "solid", row: 8, col: 13, selectable: true },
  { number: 68, symbol: "Er", name: "Erbium", weight: "167.259", category: "lanthanide", state: "solid", row: 8, col: 14, selectable: true },
  { number: 69, symbol: "Tm", name: "Thulium", weight: "168.934", category: "lanthanide", state: "solid", row: 8, col: 15, selectable: true },
  { number: 70, symbol: "Yb", name: "Ytterbium", weight: "173.045", category: "lanthanide", state: "solid", row: 8, col: 16, selectable: true },
  { number: 71, symbol: "Lu", name: "Lutetium", weight: "174.967", category: "lanthanide", state: "solid", row: 8, col: 17, selectable: true },

  // Actinoids — rendered as a separate row (9) beneath the main grid
  { number: 89, symbol: "Ac", name: "Actinium", weight: "(227)", category: "actinide", state: "solid", row: 9, col: 3, selectable: true },
  { number: 90, symbol: "Th", name: "Thorium", weight: "232.038", category: "actinide", state: "solid", row: 9, col: 4, selectable: true },
  { number: 91, symbol: "Pa", name: "Protactinium", weight: "231.036", category: "actinide", state: "solid", row: 9, col: 5, selectable: true },
  { number: 92, symbol: "U", name: "Uranium", weight: "238.029", category: "actinide", state: "solid", row: 9, col: 6, selectable: true },
  { number: 93, symbol: "Np", name: "Neptunium", weight: "(237)", category: "actinide", state: "unknown", row: 9, col: 7, selectable: true },
  { number: 94, symbol: "Pu", name: "Plutonium", weight: "(244)", category: "actinide", state: "unknown", row: 9, col: 8, selectable: true },
  { number: 95, symbol: "Am", name: "Americium", weight: "(243)", category: "actinide", state: "unknown", row: 9, col: 9, selectable: true },
  { number: 96, symbol: "Cm", name: "Curium", weight: "(247)", category: "actinide", state: "unknown", row: 9, col: 10, selectable: true },
  { number: 97, symbol: "Bk", name: "Berkelium", weight: "(247)", category: "actinide", state: "unknown", row: 9, col: 11, selectable: true },
  { number: 98, symbol: "Cf", name: "Californium", weight: "(251)", category: "actinide", state: "unknown", row: 9, col: 12, selectable: true },
  { number: 99, symbol: "Es", name: "Einsteinium", weight: "(252)", category: "actinide", state: "unknown", row: 9, col: 13, selectable: true },
  { number: 100, symbol: "Fm", name: "Fermium", weight: "(257)", category: "actinide", state: "unknown", row: 9, col: 14, selectable: true },
  { number: 101, symbol: "Md", name: "Mendelevium", weight: "(258)", category: "actinide", state: "unknown", row: 9, col: 15, selectable: true },
  { number: 102, symbol: "No", name: "Nobelium", weight: "(259)", category: "actinide", state: "unknown", row: 9, col: 16, selectable: true },
  { number: 103, symbol: "Lr", name: "Lawrencium", weight: "(266)", category: "actinide", state: "unknown", row: 9, col: 17, selectable: true },
];

export const ELEMENTS_BY_SYMBOL: Record<string, ElementData> = Object.fromEntries(
  ELEMENTS.map((e) => [e.symbol, e])
);
